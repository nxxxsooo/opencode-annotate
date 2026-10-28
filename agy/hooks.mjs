import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { dequeueAnnotations, defaultInboxRoot } from "./inbox.mjs"
import { listTargets, registryRoot } from "../bridge/receiver.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString("utf8").trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

export async function handleSessionStart(payload, { root = registryRoot(), inboxRoot = defaultInboxRoot() } = {}) {
  const conversationId = payload.conversationId
  if (!conversationId) return {}

  // Check if a receiver target is already registered for this session
  const targets = await listTargets(root)
  const exists = targets.some(t => t.sessionID === conversationId)
  if (!exists) {
    const dir = payload.workspacePaths?.[0] || process.cwd()
    const daemonScript = path.join(__dirname, "daemon.mjs")
    const args = ["--session", conversationId, "--dir", dir]
    if (process.ppid) args.push("--pid", String(process.ppid))

    const child = spawn(process.execPath, [daemonScript, ...args], {
      detached: true,
      stdio: "ignore",
    })
    child.unref()
  }

  return {}
}

export async function handlePreInvocation(payload, { inboxRoot = defaultInboxRoot() } = {}) {
  const conversationId = payload.conversationId
  if (!conversationId) return {}

  const dequeued = await dequeueAnnotations(conversationId, inboxRoot)
  if (!dequeued || !dequeued.combinedMarkdown.trim()) {
    return {}
  }

  return {
    injectSteps: [
      {
        userMessage: `# Delivered Annotations\n\n${dequeued.combinedMarkdown}`,
      },
    ],
  }
}

export async function handleStop(payload, { inboxRoot = defaultInboxRoot() } = {}) {
  const conversationId = payload.conversationId
  if (!conversationId) return {}

  const dequeued = await dequeueAnnotations(conversationId, inboxRoot)
  if (!dequeued || !dequeued.combinedMarkdown.trim()) {
    return {}
  }

  return {
    decision: "continue",
    reason: `Delivered annotations:\n\n${dequeued.combinedMarkdown}`,
  }
}

export async function runHook(event, payload, options = {}) {
  switch (event) {
    case "SessionStart":
    case "session-start":
      return handleSessionStart(payload, options)
    case "PreInvocation":
    case "pre-invocation":
      return handlePreInvocation(payload, options)
    case "Stop":
    case "stop":
      return handleStop(payload, options)
    default:
      return {}
  }
}

if (process.argv[1] && process.argv[1].endsWith("hooks.mjs")) {
  const event = process.argv[2]
  const payload = await readStdin()
  const result = await runHook(event, payload)
  process.stdout.write(JSON.stringify(result) + "\n")
}
