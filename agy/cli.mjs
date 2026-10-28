#!/usr/bin/env node
import { spawn, execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { randomUUID, createHash } from "node:crypto"
import { findSessionForDirectory, getActiveAgySessions } from "./session.mjs"
import { extractAgyReplies, latestCompletedReply, defaultBrainDir } from "./transcript.mjs"
import { enqueueAnnotations, listPendingBatches, defaultInboxRoot } from "./inbox.mjs"
import { startAgyDaemon } from "./daemon.mjs"
import { listTargets, registryRoot } from "../bridge/receiver.mjs"
import { browserTarget } from "../targets.mjs"
import { prepareTheme } from "../theme.mjs"
import { createInputSource } from "../input-source.mjs"
import { resolveTuiBinary } from "../tui/binary.mjs"

const execute = promisify(execFile)

export function getAdaptedThemeTokens() {
  const rgba = (r, g, b, a = 1) => ({ r: r / 255, g: g / 255, b: b / 255, a })
  const text = rgba(248, 248, 242), bg = rgba(40, 42, 54), accent = rgba(189, 147, 249)
  return {
    text: { base: text, muted: rgba(98, 114, 164), action: { primary: { selected: accent, focused: bg } },
      feedback: { warning: { base: rgba(241, 250, 140) }, success: { base: rgba(80, 250, 123) }, error: { base: rgba(255, 85, 85) } } },
    background: { base: bg, raised: { base: rgba(33, 34, 44), high: rgba(68, 71, 90) },
      action: { primary: { base: rgba(98, 114, 164), focused: accent } },
      feedback: { success: { base: rgba(80, 250, 123) }, warning: { base: rgba(241, 250, 140) } } },
    border: { base: rgba(68, 71, 90) },
    markdown: { heading: accent, code: rgba(80, 250, 123), link: rgba(139, 233, 253), blockQuote: rgba(98, 114, 164),
      strong: rgba(255, 184, 108), emphasis: rgba(241, 250, 140), listItem: rgba(139, 233, 253),
      linkText: rgba(255, 121, 198), listEnumeration: rgba(80, 250, 123), horizontalRule: rgba(68, 71, 90) },
    diff: { background: { added: rgba(26, 58, 26) } },
  }
}

function usage() {
  console.log(`Usage: agy-annotate <command> [options]

Commands:
  status               Show active AGY sessions and annotation pairing state
  web [target]         Pair browser companion with current AGY session (or open URL/HTML)
  tui [path]           Review latest AGY reply or markdown document in Annotate TUI
  queue                List pending annotations queued for current AGY session

Options:
  --session <id>       Explicit AGY conversation ID (defaults to cwd-matched active session)
  --binary <path>      Override the bundled Annotate TUI executable
`)
}

async function resolveSession(targetId) {
  if (targetId) {
    const sessions = getActiveAgySessions()
    const found = sessions.find(s => s.conversationId === targetId || s.conversationId.startsWith(targetId))
    if (!found) throw new Error(`No active AGY session found with ID "${targetId}"`)
    return found
  }

  const current = findSessionForDirectory(process.cwd())
  if (!current) {
    const active = getActiveAgySessions()
    if (active.length === 0) throw new Error("No active AGY sessions found. Launch 'agy' first.")
    if (active.length === 1) return active[0]
    throw new Error(`Multiple active AGY sessions found (${active.length}). Specify --session <id>.`)
  }
  return current
}

async function cmdStatus() {
  const sessions = getActiveAgySessions()
  const targets = await listTargets()

  if (sessions.length === 0) {
    console.log("No active AGY sessions currently running.")
    return
  }

  console.log(`Active AGY Sessions (${sessions.length}):\n`)
  for (const session of sessions) {
    const paired = targets.find(t => t.sessionID === session.conversationId)
    const inbox = await listPendingBatches(session.conversationId)
    const pairedStatus = paired ? `paired (target ${paired.id.slice(0, 8)})` : "not paired"
    const inboxStatus = inbox.length ? `[${inbox.length} pending annotations]` : "[inbox clear]"

    console.log(`  • [${session.conversationId.slice(0, 8)}] ${session.title}`)
    console.log(`    PID: ${session.pid} | Directory: ${session.directory}`)
    console.log(`    Status: ${pairedStatus} | ${inboxStatus}\n`)
  }
}

async function cmdWeb(targetArg, options) {
  const session = await resolveSession(options.session)
  const targets = await listTargets()
  let paired = targets.find(t => t.sessionID === session.conversationId)

  if (!paired) {
    const daemonScript = path.join(path.dirname(new URL(import.meta.url).pathname), "daemon.mjs")
    const args = ["--session", session.conversationId, "--dir", session.directory, "--title", session.title]
    if (session.pid) args.push("--pid", String(session.pid))

    const child = spawn(process.execPath, [daemonScript, ...args], {
      detached: true,
      stdio: "ignore",
    })
    child.unref()

    // Wait briefly for socket registration
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 50))
      const fresh = await listTargets()
      paired = fresh.find(t => t.sessionID === session.conversationId)
      if (paired) break
    }
  }

  console.log(`✓ Session paired for browser review: "${session.title}" (${session.conversationId.slice(0, 8)})`)
  console.log(`  Open Chrome extension "Annotate" and choose this session.`)

  if (targetArg && targetArg.trim()) {
    const target = await browserTarget(targetArg, session.directory)
    if (target?.url) {
      console.log(`  Opening Chrome target: ${target.url}`)
      if (process.platform === "darwin") {
        await execute("open", ["-a", "Google Chrome", target.url])
      }
    }
  }
}

async function cmdQueue(options) {
  const session = await resolveSession(options.session)
  const batches = await listPendingBatches(session.conversationId)

  if (batches.length === 0) {
    console.log(`Inbox is clear for session "${session.title}".`)
    return
  }

  console.log(`Queued Annotations for "${session.title}" (${batches.length} batches):\n`)
  for (const [index, batch] of batches.entries()) {
    console.log(`Batch ${index + 1} (${batch.batchID}) - Created ${batch.createdAt}:`)
    console.log(batch.markdown)
    console.log("\n--------------------------------------------------\n")
  }
}

async function cmdTui(targetPath, options) {
  const session = await resolveSession(options.session)
  const binary = resolveTuiBinary(options.binary)
  const brainDir = defaultBrainDir(session.conversationId)
  const calledByAgent = Boolean(process.env.ANTIGRAVITY_AGENT || process.env.AGENT_TOOL_CALL)
  const isInteractiveTTY = Boolean(options.interactiveTty) || (!calledByAgent && Boolean(process.stdin.isTTY) && !options.spawnWindow)

  if (!isInteractiveTTY) {
    const launcherScript = path.join(os.tmpdir(), `agy-annotate-launch-${Date.now()}.sh`)
    const doneMarker = path.join(os.tmpdir(), `agy-annotate-done-${Date.now()}.txt`)
    const cliScript = path.resolve(new URL(import.meta.url).pathname)
    const tuiArgs = [cliScript, "tui", "--interactive-tty", "--session", session.conversationId]
    if (targetPath) tuiArgs.push(targetPath)
    if (options.binary) tuiArgs.push("--binary", options.binary)

    const escapedTitle = (session.title || "Review").replace(/'/g, "'\\''")
    const shellCmd = `printf '\\033]0;Annotate: %s\\007' '${escapedTitle}'\n${process.execPath} ${tuiArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}; echo done > '${doneMarker}'`
    await writeFile(launcherScript, `#!/bin/sh\n${shellCmd}\n`, { mode: 0o755 })

    const beforeBatches = await listPendingBatches(session.conversationId)

    let launched = false
    try {
      const windowTitle = `Annotate: ${session.title}`
      await execute("open", ["-na", "Ghostty", "--args", "--window-width=172", "--window-height=48", `--title=${windowTitle}`, "-e", launcherScript])
      launched = true
    } catch {
      try {
        await execute("osascript", ["-e", `tell application "Terminal" to do script "${launcherScript}"`, "-e", 'tell application "Terminal" to activate'])
        launched = true
      } catch (err) {
        throw new Error(`Failed to spawn interactive review window: ${err.message}`)
      }
    }

    console.log(`Opened interactive Annotate TUI window for "${session.title}".`)
    console.log("Waiting for user to complete annotations (press 'q' or Ctrl+S to finish)...")

    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 1000))
      const currentBatches = await listPendingBatches(session.conversationId)
      if (currentBatches.length > beforeBatches.length) {
        const newest = currentBatches[currentBatches.length - 1]
        console.log(`\n✓ Annotations received from review window:\n\n${newest.markdown}`)
        try { await rm(launcherScript, { force: true }); await rm(doneMarker, { force: true }) } catch {}
        return
      }
      try {
        await readFile(doneMarker)
        await new Promise(r => setTimeout(r, 500))
        const finalBatches = await listPendingBatches(session.conversationId)
        if (finalBatches.length > beforeBatches.length) {
          const newest = finalBatches[finalBatches.length - 1]
          console.log(`\n✓ Annotations received from review window:\n\n${newest.markdown}`)
        } else {
          console.log("Interactive review window closed without annotations.")
        }
        try { await rm(launcherScript, { force: true }); await rm(doneMarker, { force: true }) } catch {}
        return
      } catch {
        // Still waiting
      }
    }
    return
  }

  let sourceText = ""
  let snapshotName = "last-reply.md"
  let filePath = null
  let sourceHash = null

  if (targetPath) {
    const resolvedPath = path.resolve(session.directory, targetPath)
    sourceText = await readFile(resolvedPath, "utf8")
    filePath = resolvedPath
    snapshotName = path.basename(resolvedPath)
    sourceHash = createHash("sha256").update(Buffer.from(sourceText)).digest("hex")
  } else {
    const replies = await extractAgyReplies(brainDir)
    const latest = latestCompletedReply(replies)
    if (!latest || !latest.text.trim()) {
      throw new Error(`No completed assistant replies found in session "${session.title}".`)
    }
    sourceText = latest.text
    snapshotName = `reply-${latest.id}.md`
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agy-annotate-"))
  const snapshotFile = path.join(tempDir, snapshotName)
  const dataDir = path.join(tempDir, "data")
  const intentPath = path.join(tempDir, "send-intent")

  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  await writeFile(snapshotFile, sourceText, { mode: 0o600 })

  let env = {
    ...process.env,
    PLANNOTATOR_DATA_DIR: dataDir,
    PLANNOTATOR_FEEDBACK_HISTORY: "0",
    PLANNOTATOR_TUI_SEND_INTENT: intentPath,
  }

  env = await prepareTheme({ binary, theme: getAdaptedThemeTokens(), directory: tempDir, env })

  // Browse in ASCII so an input method cannot swallow review keys; see input-source.mjs.
  const inputSource = createInputSource()
  const textSource = await inputSource.ascii()
  if (inputSource.command && textSource) {
    env.PLANNOTATOR_TUI_INPUT_SOURCE = inputSource.command
    env.PLANNOTATOR_TUI_TEXT_INPUT_SOURCE = textSource
  }

  try {
    // Run the bundled reviewer interactively.
    const child = spawn(binary, [snapshotFile], {
      cwd: tempDir,
      env,
      stdio: "inherit",
    })

    await new Promise((resolve, reject) => {
      child.on("exit", (code, signal) => {
        if (signal) reject(new Error(`TUI killed by signal ${signal}`))
        else resolve(code)
      })
      child.on("error", reject)
    }).finally(() => inputSource.select(textSource))

    // Export annotations
    const { stdout } = await execute(binary, ["--export", snapshotFile], {
      cwd: tempDir,
      env,
      timeout: 15000,
    })
    const feedback = stdout.trim()

    if (!feedback || feedback === "No annotations.") {
      console.log("No annotations created. Returned to terminal.")
      return
    }

    const header = filePath
      ? `Annotations on document \`${filePath}\` (SHA-256: ${sourceHash}):`
      : `Annotations on latest assistant response in session "${session.title}":`
    const combined = `${header}\n\n${feedback}`

    await enqueueAnnotations(session.conversationId, {
      batchID: `tui-${Date.now()}`,
      markdown: combined,
      promptID: `msg_${randomUUID()}`,
    })

    console.log(`\n✓ Enqueued annotations for AGY session: "${session.title}"`)
    console.log(`  The next AGY turn or invocation will ingest this feedback.`)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    usage()
    return
  }

  const command = args[0]
  const options = {}
  let posArg = null

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--session") {
      options.session = args[++i]
    } else if (args[i] === "--binary") {
      options.binary = args[++i]
    } else if (args[i] === "--interactive-tty") {
      options.interactiveTty = true
    } else if (!args[i].startsWith("-") && !posArg) {
      posArg = args[i]
    }
  }

  switch (command) {
    case "status":
      await cmdStatus()
      break
    case "web":
      await cmdWeb(posArg, options)
      break
    case "tui":
      await cmdTui(posArg, options)
      break
    case "queue":
      await cmdQueue(options)
      break
    default:
      console.error(`Unknown command: "${command}"`)
      usage()
      process.exit(1)
  }
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isDirectExecution) {
  main().catch(err => {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  })
}
