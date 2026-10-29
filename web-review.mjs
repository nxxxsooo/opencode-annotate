import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { browserTarget } from "./targets.mjs"
import { createReceiver } from "./bridge/receiver.mjs"

const execute = promisify(execFile)
export function createWebReview(context, options = {}) {
  const receivers = new Map()
  let disposed = false
  return {
    async run(input, sessionID, signal) {
      if (input.trim() === "web off") {
        await receivers.get(sessionID)?.close(); receivers.delete(sessionID)
        context.ui.toast.show({ title: "Annotate web", message: "Browser pairing revoked for this session." })
        return true
      }
      // Home has no session until the first prompt. Capture its location/model before
      // awaiting, then create an empty destination without sending a prompt.
      const route = context.ui.router.current()
      const location = sessionID ? undefined : context.location ?? context.data.location.default()
      const selected = sessionID ? undefined : context.ui.model.current()
      const model = selected && { providerID: selected.providerID, id: selected.modelID, variant: selected.variant }
      let session = sessionID ? await context.client.session.get({ sessionID }, { signal }) : undefined
      const target = await browserTarget(input, session ? session.location?.directory : location?.directory)
      if (!target) return false
      if (disposed) throw new Error("Annotation plugin is closed")
      signal?.throwIfAborted()
      if (!session) {
        if (!location?.directory) throw new Error("Can't determine the working directory for a new session.")
        session = await context.client.session.create({ location, ...(model ? { model } : {}) }, { signal })
        if (disposed || signal?.aborted) return true
        sessionID = session.id
        // A tab switch during creation must not steal focus back from the user.
        if (context.ui.router.current() === route) {
          context.ui.dialog.clear()
          context.ui.router.navigate({ type: "session", sessionID })
        }
      }
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
