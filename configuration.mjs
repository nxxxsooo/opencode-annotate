// OpenCode 2.2's server inventory supplies the TUI package, but drops its options.
// Carry only this plugin's effective options through the official location-scoped RPC.
export const configurationRPC = {
  id: "annotate.configuration",
  methods: {
    get: { input: { type: "object", additionalProperties: false }, output: { type: "object", additionalProperties: true } },
  },
  events: { updated: { schema: { type: "object", additionalProperties: false } } },
}

export async function registerConfiguration(context) {
  const registration = await context.rpc.register(configurationRPC, { get: async () => context.options })
  await registration.events.emit("updated", {})
  return registration
}

export function watchConfiguration(context, apply) {
  const local = context.options
  const rpc = context.client.rpc(configurationRPC)
  let disposed = false
  let generation = 0
  let controller
  const refresh = async () => {
    const request = ++generation
    controller?.abort()
    controller = new AbortController()
    try {
      const options = await rpc.get({}, {
        location: context.location ?? context.data.location.default(), signal: controller.signal,
      })
      if (!disposed && request === generation) apply({ ...options, ...local })
    } catch (error) {
      if (disposed || request !== generation) return
      // A CLI-only installation has no server part; its local options are authoritative.
      if (error.type === "rpc.unavailable") return apply(local)
      context.ui.toast.show({
        title: "Annotate", message: `Can't load plugin configuration: ${error.message ?? String(error)}`,
        variant: "error", duration: 15000,
      })
    }
  }
  const stops = [
    context.data.on("plugin.updated", () => { void refresh() }),
    context.data.on("rpc.annotate.configuration.updated", () => { void refresh() }),
  ]
  const ready = refresh()
  return {
    ready,
    dispose() {
      disposed = true
      generation++
      controller?.abort()
      for (const stop of stops) stop()
    },
  }
}
