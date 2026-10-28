import { createAgyReceiver, getAgySessionTitle } from "./receiver.mjs"
import { parseArgs } from "node:util"
import path from "node:path"

export async function startAgyDaemon({ conversationId, pid, directory, title, root, inboxRoot }) {
  if (!conversationId) throw new Error("conversationId is required")

  const receiver = await createAgyReceiver({
    conversationId,
    title,
    directory: directory || process.cwd(),
    root,
    inboxRoot,
  })

  // Watch parent AGY process PID; auto-exit when AGY exits
  if (pid && Number.isInteger(pid) && pid > 0) {
    const timer = setInterval(() => {
      try {
        process.kill(pid, 0)
      } catch {
        clearInterval(timer)
        receiver.close().finally(() => process.exit(0))
      }
    }, 2000)
    timer.unref()
  }

  const cleanup = async () => {
    await receiver.close()
    process.exit(0)
  }

  process.once("SIGINT", cleanup)
  process.once("SIGTERM", cleanup)

  return receiver
}

if (process.argv[1] && process.argv[1].endsWith("daemon.mjs")) {
  const { values } = parseArgs({
    options: {
      session: { type: "string" },
      pid: { type: "string" },
      dir: { type: "string" },
      title: { type: "string" },
    },
  })

  if (!values.session) {
    console.error("Usage: node daemon.mjs --session <conversationId> [--pid <pid>] [--dir <dir>] [--title <title>]")
    process.exit(1)
  }

  await startAgyDaemon({
    conversationId: values.session,
    pid: values.pid ? parseInt(values.pid, 10) : undefined,
    directory: values.dir,
    title: values.title,
  })

  // Keep daemon alive until killed or parent PID exits
  await new Promise(() => {})
}
