import { browserTarget } from "./targets.mjs"
import { createReceiver } from "./bridge/receiver.mjs"
import { openInBrowser } from "./scripts/browser-target.mjs"
// OpenCode home has no session until the first prompt; a new one inherits its location and model.
export function homeSession(context) {
  const location = context.location ?? context.data.location.default()
  const selected = context.ui.model.current()
  return { location, model: selected && { providerID: selected.providerID, id: selected.modelID, variant: selected.variant } }
}
export function createWebReview(context, options = {}) {
  const receivers = new Map(), registrations = new Map(), deleted = new Set()
  let disposed = false
  async function register(sessionID, session) {
    session ??= await context.client.session.get({ sessionID })
    if (disposed || deleted.has(sessionID)) return
    const receiver = await createReceiver({ sessionID, title: session.title || sessionID, directory: session.location?.directory || "", client: context.client,
      createSession: () => newSession(sessionID), ...options.receiver })
    if (disposed || deleted.has(sessionID)) { await receiver.close(); return }
    receivers.set(sessionID, receiver)
    return receiver
  }
  function ensure(sessionID, session) {
    if (disposed || deleted.has(sessionID)) return Promise.resolve()
    if (receivers.has(sessionID)) return Promise.resolve(receivers.get(sessionID))
    if (registrations.has(sessionID)) return registrations.get(sessionID)
    const registration = register(sessionID, session).finally(() => registrations.delete(sessionID))
    registrations.set(sessionID, registration)
    return registration
  }
  async function close(sessionID) {
    deleted.add(sessionID)
    await registrations.get(sessionID)?.catch(() => {})
    const receiver = receivers.get(sessionID)
    receivers.delete(sessionID)
    await receiver?.close()
  }
  const home = () => homeSession(context)
  async function create(input, route, signal) {
    if (!input.location?.directory) throw new Error("Can't determine the working directory for a new session.")
    if (disposed) throw new Error("Annotation plugin is closed")
    signal?.throwIfAborted()
    const session = await context.client.session.create(input, { signal })
    if (disposed || signal?.aborted) throw new Error("Annotation session creation was interrupted; reopen the new session in OpenCode.")
    const receiver = await ensure(session.id, session)
    if (!receiver || disposed) throw new Error("Annotation plugin is closed")
    if (context.ui.router.current() === route) {
      context.ui.dialog.clear()
      context.ui.router.navigate({ type: "session", sessionID: session.id })
    }
    return receiver
  }
  async function newSession(sessionID) {
    // Capture the source before awaiting. The browser cannot supply an arbitrary path/model.
    const route = context.ui.router.current()
    const input = sessionID ? await context.client.session.get({ sessionID }) : home()
    if (!sessionID && route.type !== "home") throw new Error("OpenCode home is no longer open; choose a session instead.")
    const focus = sessionID && (route.type !== "session" || route.sessionID !== sessionID) ? undefined : route
    const receiver = await create({ location: input.location, ...(input.model ? { model: input.model } : {}) }, focus)
    return receiver.info()
  }
  const route = context.ui.router.current()
  const automatic = options.autoRegister === true
  // A home workspace is discoverable without creating a session or starting a model.
  const workspace = automatic ? createReceiver({ title: "OpenCode home", provider: "opencode", ...options.receiver,
    getInfo: () => context.ui.router.current().type === "home" ? { directory: home().location?.directory || "" } : null,
    createSession: () => newSession(),
  }).then(async receiver => { if (disposed) await receiver.close(); return receiver }) : Promise.resolve()
  const ready = Promise.all([workspace, automatic && route.type === "session" ? ensure(route.sessionID) : undefined])
  ready.catch(error => {
    if (!disposed) context.ui.toast.show({ title: "Annotate", message: `Browser connection failed: ${error.message}`, variant: "error" })
  })
  const onSession = event => {
    const route = context.ui.router.current()
    // Session events are service-wide; only expose the session active in this TUI.
    if (route.type === "session" && route.sessionID === event.data.sessionID) void ensure(route.sessionID).catch(() => {})
  }
  const stops = automatic && context.data.on ? [
    context.data.on("session.execution.started", onSession),
    context.data.on("session.deleted", event => { void close(event.data.sessionID).catch(() => {}) }),
  ] : []
  return {
    ready: async () => { await ready; await Promise.all([...registrations.values()]) },
    async run(input, sessionID, signal) {
      // Home has no session until the first prompt. Capture its location/model before
      // awaiting, then create an empty destination without sending a prompt.
      const route = context.ui.router.current()
      const initial = sessionID ? undefined : home()
      const session = sessionID ? await context.client.session.get({ sessionID }, { signal }) : undefined
      const target = await browserTarget(input, session ? session.location?.directory : initial.location?.directory)
      if (!target) throw new Error("Use a webpage URL or an HTML file.")
      await ready
      if (disposed) throw new Error("Annotation plugin is closed")
      signal?.throwIfAborted()
      const receiver = session ? await ensure(sessionID, session) : await create(initial, route, signal)
      if (!receiver) throw new Error("This annotation session is no longer available")
      if (disposed) return true
      if (target.url) {
        if (options.open) await options.open(target.url)
        else await openInBrowser(target.url, options)
      }
      context.ui.toast.show({ title: "Annotate", message: `Page opened. Choose ${receiver.target.title} in the Annotate extension.`, duration: 10000 })
      return true
    },
    async dispose() {
      disposed = true
      for (const stop of stops) stop()
      await Promise.allSettled([...registrations.values()])
      const homeReceiver = await workspace.catch(() => undefined)
      await homeReceiver?.close()
      await Promise.all([...receivers.values()].map(receiver => receiver.close()))
      receivers.clear()
    },
  }
}
