import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { browserTarget } from "./targets.mjs"
import { createReceiver } from "./bridge/receiver.mjs"

const execute = promisify(execFile)
export function createWebReview(context, options = {}) {
  const receivers = new Map()
  let disposed = false
  return {
    async run(input, sessionID) {
      if (input.trim() === "web off") {
        await receivers.get(sessionID)?.close(); receivers.delete(sessionID)
        context.ui.toast.show({ title: "Annotate web", message: "Browser pairing revoked for this session." })
        return true
      }
      const session = await context.client.session.get({ sessionID })
      const target = await browserTarget(input, session.location?.directory)
      if (!target) return false
      if (disposed) throw new Error("Annotation plugin is closed")
      if (!receivers.has(sessionID)) {
        const receiver = await createReceiver({ sessionID, title: session.title || sessionID, directory: session.location?.directory || "", client: context.client, ...options.receiver })
        if (disposed) { await receiver.close(); return true }
        receivers.set(sessionID, receiver)
      }
      if (target.url) {
        if (options.open) await options.open(target.url)
        else if (process.platform === "darwin") await execute("open", ["-a", "Google Chrome", target.url])
        else throw new Error("Browser review currently requires macOS")
      }
      context.ui.toast.show({ title: "Annotate web", message: `Ready for browser pairing: ${session.title || sessionID}. Open the extension and select this session.`, duration: 10000 })
      return true
    },
    async dispose() { disposed = true; await Promise.all([...receivers.values()].map(receiver => receiver.close())); receivers.clear() },
  }
}
