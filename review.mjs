import { spawn, execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { createWebReview } from "./web-review.mjs"
import { feedbackInput } from "./delivery.mjs"
import { wantsBrowser } from "./targets.mjs"
import { prepareTheme } from "./theme.mjs"
import { createInputSource } from "./input-source.mjs"
import { resolveTuiBinary } from "./tui/binary.mjs"
import { finishedAssistant } from "./session-reference.mjs"

const execute = promisify(execFile)
const documentExtensions = new Set([".md", ".mdx", ".markdown", ".txt"])
const maxDocumentBytes = 2 * 1024 * 1024

async function documentSource(input, client, sessionID, signal) {
  let target = input.trim()
  if ((target.startsWith('"') && target.endsWith('"')) || (target.startsWith("'") && target.endsWith("'"))) {
    target = target.slice(1, -1)
  }
  if (!target || !documentExtensions.has(path.extname(target).toLowerCase())) {
    throw new Error("Choose a Markdown or plain-text file (.md, .mdx, .markdown, .txt).")
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) throw new Error("Use a local file path.")
  if (target.startsWith("~/")) target = path.join(os.homedir(), target.slice(2))
  const session = await client.session.get({ sessionID }, { signal })
  const directory = session.location?.directory
  if (!path.isAbsolute(target) && !directory) throw new Error("Can't determine the current session's working directory.")
  const filePath = path.isAbsolute(target) ? path.normalize(target) : path.resolve(directory, target)
  try {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error("The target is not a file.")
    if (info.size > maxDocumentBytes) throw new Error("The file is larger than 2 MiB. Choose a smaller document.")
    const bytes = await readFile(filePath, { signal })
    if (bytes.length > maxDocumentBytes) throw new Error("The file is larger than 2 MiB.")
    if (bytes.includes(0)) throw new Error("The file contains binary content.")
    let text
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
      throw new Error("Use a UTF-8 text file.")
    }
    return {
      text, filePath,
      sourceHash: createHash("sha256").update(bytes).digest("hex"),
      snapshot: path.join("source", path.basename(filePath)),
    }
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error(`Can't read document "${filePath}": ${error.code === "ENOENT" ? "file not found." : error.message}`)
  }
}

export function selectReply(messages) {
  return eligibleReplies(messages)[0]
}

// Completed assistant text, newest first. Mid-turn progress updates (finish "tool-calls")
// are text the user can read in the transcript, so pick and selection include them.
function textMessages(messages) {
  const texts = []
  const newest = [...messages].sort((a, b) =>
    b.time.created - a.time.created || b.id.localeCompare(a.id),
  )
  for (const message of newest) {
    if (!finishedAssistant(message) || message.finish === "content-filter") continue
    const text = message.content.filter(part => part.type === "text").map(part => part.text).join("\n\n")
    if (text.trim()) {
      texts.push({ id: message.id, text, progress: message.finish === "tool-calls", created: message.time.created })
    }
  }
  return texts
}

function eligibleReplies(messages) {
  return textMessages(messages).filter(message => !message.progress).map(({ id, text }) => ({ id, text }))
}

// OpenCode 2.2.0 compresses API responses at roughly 80 KB/s, so a page of long
// replies took 10–30 s; uncompressed, the same local page arrives in milliseconds.
const uncompressed = { "accept-encoding": "identity" }

// Walk the session-scoped history newest first; the UI cache holds only a recent page.
async function* history(client, sessionID, signal) {
  const seen = new Set()
  let cursor
  do {
    signal.throwIfAborted()
    const page = await client.message.list({
      sessionID, type: "assistant", limit: 50,
      ...(cursor ? { cursor } : { order: "desc" }),
    }, { signal, headers: uncompressed })
    yield page.data
    cursor = page.cursor?.next
    if (cursor && seen.has(cursor)) throw new Error("Session history returned a repeated page cursor.")
    seen.add(cursor)
  } while (cursor)
}

async function latestReply(client, sessionID, signal) {
  for await (const page of history(client, sessionID, signal)) {
    const [reply] = eligibleReplies(page)
    if (reply) return reply
  }
}

async function recentTexts(client, sessionID, signal, limit) {
  const texts = new Map()
  for await (const page of history(client, sessionID, signal)) {
    for (const message of textMessages(page)) {
      texts.set(message.id, message)
      if (texts.size >= limit) return [...texts.values()]
    }
  }
  return [...texts.values()]
}

// Rendered transcript text drops Markdown markers and rewraps lines, so compare letters
// and digits only.
const compact = text => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
const preview = (text, length) => {
  const line = text.replace(/[#*_`>]+/g, "").replace(/\s+/g, " ").trim()
  return line.length > length ? `${line.slice(0, length - 1)}…` : line
}

async function archivedNotes(data) {
  let count = 0
  for (const name of await readdir(data, { recursive: true })) {
    if (path.basename(name) !== "annotations.json") continue
    const record = JSON.parse(await readFile(path.join(data, name), "utf8"))
    count += record.archived?.length ?? 0
  }
  return count
}

// A "what?" note asks for an explanation. The configured skill (default: what) can hold
// pending work while the agent explains; without it, the TUI's instruction stands alone.
const whatNote = /^Comment on: .*\n> what\?$/m

async function whatSkills(client, option, feedback, sessionID, signal) {
  if (option === false || !whatNote.test(feedback)) return []
  if (option !== undefined && (typeof option !== "string" || !option.trim())) {
    throw new Error('Set the whatSkill option to a skill ID or false.')
  }
  const id = option?.trim() ?? "what"
  const session = await client.session.get({ sessionID }, { signal })
  const directory = session.location?.directory
  const { data } = await client.skill.list(directory ? { location: { directory } } : {}, { signal })
  if (data.some(skill => skill.id === id)) return [{ id }]
  if (option !== undefined) throw new Error(`Can't find the "${id}" skill set as whatSkill. Install it, or set whatSkill to false.`)
  return []
}

async function interactive({ binary, file, cwd, env, signal }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Run /annotate in the full OpenCode terminal interface.")
  }
  await new Promise((resolve, reject) => {
    const child = spawn(binary, [file], { cwd, env, stdio: "inherit", signal })
    child.once("error", reject)
    child.once("close", (code, termination) => {
      if (code === 0) resolve()
      else reject(new Error(`Annotate TUI exited: ${termination ?? code}`))
    })
  })
}

export function createReviewCommand(context, options = {}) {
  const web = createWebReview(context, options.web)
  const binary = resolveTuiBinary(options.binary ?? context.options.binary)
  const runInteractive = options.interactive ?? interactive
  const inputSource = options.inputSource ?? createInputSource(context.options.inputSource)
  let active
  let disposed = false
  const notice = (message, variant = "info") => context.ui.toast.show({
    title: "Annotate", message, variant, duration: variant === "error" ? 15000 : 5000,
  })

  let selection
  const remember = current => {
    const text = current?.getSelectedText?.() ?? ""
    const route = context.ui.router.current()
    if (text.trim() && route.type === "session") selection = { text, sessionID: route.sessionID }
  }
  // OpenCode copies a mouse selection and clears it on release, before any command can
  // run, so keep the last one per session.
  context.renderer.on("selection", remember)

  async function start(resolve, { automatic, home = false, sessionID: capturedSessionID, submission } = {}) {
    if (disposed) return
    if (automatic && (active || !automatic())) return
    if (active) return notice("An annotation is already in progress.")
    // Capture before the first await: changing tabs must never redirect a review.
    const route = context.ui.router.current()
    if (capturedSessionID === undefined && route.type !== "session" && !(home && route.type === "home")) return notice("Open a session first.")
    // null: the submission creates its destination only after confirmation.
    const sessionID = capturedSessionID === undefined ? (route.type === "session" ? route.sessionID : undefined) : capturedSessionID ?? undefined
    const controller = new AbortController()
    active = controller
    let directory
    let keepDraft = false
    try {
      const source = await resolve({ sessionID, signal: controller.signal })
      if (controller.signal.aborted || !source) return
      if (automatic && !automatic()) return
      const title = submission?.title ?? context.data.session.get(sessionID)?.title ?? sessionID

      directory = await mkdtemp(path.join(options.tempRoot ?? os.tmpdir(), "opencode-annotate-"))
      keepDraft = true
      const snapshot = source.snapshot ?? (source.selection ? "selection.md" : source.progress ? "progress-update.md" : "last-reply.md")
      const file = path.join(directory, snapshot)
      const data = path.join(directory, "data")
      const promptID = `msg_${randomUUID().replaceAll("-", "")}`
      await mkdir(data, { mode: 0o700 })
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
      await writeFile(file, source.text, { mode: 0o600 })
      await writeFile(path.join(directory, "review.json"), JSON.stringify({
        sessionID, messageID: source.id, filePath: source.filePath,
        sourceHash: source.sourceHash, snapshot, promptID, title,
      }, null, 2), { mode: 0o600 })

      // Use a fresh store per invocation, and disable any inherited pane delivery.
      // The OpenCode confirmation is the sole authority for sending feedback.
      let env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        !key.startsWith("HERDR_") && !key.startsWith("PLANNOTATOR_TUI_"),
      ))
      Object.assign(env, {
        PLANNOTATOR_DATA_DIR: data,
        PLANNOTATOR_FEEDBACK_HISTORY: "0",
        PLANNOTATOR_TUI_THEME: context.themeMode === "light" ? "light" : "dark",
      })
      if ((options.inheritTheme ?? context.options.inheritTheme) === true) {
        env = await prepareTheme({ binary, theme: context.theme, directory, env, signal: controller.signal })
      }
      // The reviewer writes "send" here when q or Ctrl+S quits with notes.
      const intentPath = path.join(directory, "send-intent")
      env.PLANNOTATOR_TUI_SEND_INTENT = intentPath
      if (automatic && !automatic()) {
        keepDraft = false
        return
      }
      context.ui.dialog.clear()
      // Review keys are single letters an input method would swallow: browse in ASCII, and
      // let a capable binary switch back to the user's source while a comment is written.
      const textSource = await inputSource.ascii()
      if (inputSource.command && textSource) {
        env.PLANNOTATOR_TUI_INPUT_SOURCE = inputSource.command
        env.PLANNOTATOR_TUI_TEXT_INPUT_SOURCE = textSource
      }
      if (automatic && !automatic()) {
        await inputSource.select(textSource)
        keepDraft = false
        return
      }
      // OpenCode 2.1.1+ suspends and resumes asynchronously; resume forces a full repaint.
      await context.renderer.suspend()
      try {
        if (automatic && !automatic()) {
          keepDraft = false
          return
        }
        await runInteractive({ binary, file, cwd: directory, env, signal: controller.signal })
      } finally {
        await inputSource.select(textSource)
        await context.renderer.resume()
        context.renderer.requestRender()
      }
      if (controller.signal.aborted) return
      const { stdout } = await execute(binary, ["--export", file], {
        cwd: directory, env, signal: controller.signal, timeout: 15000, maxBuffer: 8 * 1024 * 1024,
      })
      const feedback = stdout.trim()
      const archived = await archivedNotes(data)
      const retainedArchive = archived ? `\n${archived} archived ${archived === 1 ? "note was" : "notes were"} kept in ${directory}.` : ""
      // Upstream 0.9.4 emits this sentinel rather than empty stdout.
      if (!feedback || feedback === "No annotations.") {
        keepDraft = archived > 0
        return notice(archived ? `No annotations to send.${retainedArchive}` : "No annotations. Returned to the session.", archived ? "warning" : "info")
      }
      if (!feedback.startsWith("# Annotations on ")) throw new Error("Can't recognize the TUI annotation export format.")
      const subject = source.filePath
        ? `Here are my annotations on the document ${JSON.stringify(source.filePath)}. Please apply the feedback to that file.\nThe annotations are based on a snapshot taken when the document was opened (SHA-256: ${source.sourceHash}). Re-read the file and check the quoted text before editing.`
        : source.selection
          ? "Here are my annotations on text I selected in this session. Please address the feedback."
          : `Here are my annotations on your ${source.progress ? "progress update" : "reply"} ${source.id}. Please address the feedback.`
      const text = submission ? submission.text(feedback) : `${subject}\n\n${feedback}`
      const feedbackPath = path.join(directory, "feedback.md")
      await writeFile(feedbackPath, text, { mode: 0o600 })
      const count = (feedback.match(/^## Annotation /gm) ?? []).length
      const skills = submission ? [] : await whatSkills(context.client, context.options.whatSkill, feedback, sessionID, controller.signal)
      const intent = await readFile(intentPath, "utf8").catch(error => {
        if (error.code === "ENOENT") return ""
        throw error
      })
      // Pressing send in the TUI is the explicit confirmation; quitting asks here.
      const confirmed = intent.trim() === "send" || await context.ui.dialog.confirm(submission?.confirm({ count, title }) ?? {
        title: "Send annotations?",
        message: `${source.filePath ? `Document: ${source.filePath}\n` : ""}Send ${count} ${count === 1 ? "annotation" : "annotations"} to "${title}" and let the assistant continue?`,
        label: { confirm: "Send and continue", cancel: "Cancel" },
      })
      if (controller.signal.aborted) return
      if (confirmed !== true) {
        keepDraft = archived > 0
        return notice(`Sending cancelled.${retainedArchive}`)
      }
      if (submission) await submission.deliver({ sessionID, id: promptID, text })
      else await context.client.session.prompt(feedbackInput({ sessionID, id: promptID, text, ...(skills.length ? { skills } : {}) }))
      keepDraft = archived > 0
      const delivered = submission?.success?.(count) ?? `Sent ${count} ${count === 1 ? "annotation" : "annotations"}.`
      notice(`${delivered}${retainedArchive}`, "success")
    } catch (error) {
      if (!disposed) {
        const detail = error?.code === "ENOENT"
          ? "Can't find Annotate TUI. Run npm run build:tui in the checkout, or reinstall the package. Check any custom binary option."
          : error instanceof Error ? error.message : String(error)
        const recovery = keepDraft && directory
          ? `\nThe draft was kept in ${directory}. If it was exported, the feedback is in feedback.md.`
          : ""
        notice(`${detail}${recovery}`, "error")
      }
    } finally {
      if (directory && !keepDraft) {
        await rm(directory, { recursive: true, force: true }).catch(() => {})
      }
      active = undefined
    }
  }

  const run = (input = "") => {
    const target = input.trim(), browser = wantsBrowser(target)
    return start(async ({ sessionID, signal }) => {
      if (/^\d+$/.test(target)) throw new Error("Numbered replies are retired. Use /annotate-pick to choose earlier text.")
      if (browser) { await web.run(target, sessionID, signal); return }
      if (target) return documentSource(target, context.client, sessionID, signal)
      const reply = await latestReply(context.client, sessionID, signal)
      if (!reply) notice("This session has no completed assistant reply yet.")
      return reply
    }, { home: browser })
  }

  const auto = (sessionID, messageID, threshold, current = () => true) => start(async ({ signal }) => {
    const message = await context.client.session.message.get({ sessionID, messageID }, { signal, headers: uncompressed })
    const source = selectReply([message])
    // Count Unicode characters, including Markdown, rather than bytes or UTF-16 units.
    if (source && [...source.text.trim()].length > threshold) return source
  }, { automatic: () => {
    const route = context.ui.router.current()
    return current() && route.type === "session" && route.sessionID === sessionID
      && context.data.session.status(sessionID) === "idle"
  } })

  const pick = () => start(async ({ sessionID, signal }) => {
    const texts = await recentTexts(context.client, sessionID, signal, 30)
    if (!texts.length) {
      notice("This session has no completed assistant text yet.")
      return
    }
    const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" })
    const chosen = await context.ui.dialog.select({
      title: "Annotate text",
      options: texts.map(text => ({
        title: preview(text.text, 60), value: text.id,
        description: `${text.progress ? "Progress update" : "Reply"} · ${time.format(text.created)}`,
      })),
    })
    return texts.find(text => text.id === chosen)
  })

  const annotateSelection = () => start(async ({ sessionID, signal }) => {
    const selected = selection?.sessionID === sessionID ? selection.text : ""
    const needle = compact(selected)
    if (!needle) {
      notice("Select text in this session first, then run /annotate-selection.")
      return
    }
    const texts = await recentTexts(context.client, sessionID, signal, 200)
    return texts.find(text => compact(text.text).includes(needle)) ?? { text: selected, selection: true }
  })

  const snapshot = (sessionID, source, submission) => start(async () => source, { sessionID, submission })

  return {
    run, auto, pick, snapshot, selection: annotateSelection, webReady: web.ready,
    dispose() {
      context.renderer.off("selection", remember)
      disposed = true
      active?.abort()
      return web.dispose()
    },
  }
}
