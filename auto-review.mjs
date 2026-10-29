const defaultThreshold = 2000

export function autoReviewOptions(options) {
  const enabled = options.autoAnnotate === undefined ? false : options.autoAnnotate
  const threshold = options.autoAnnotateThreshold === undefined ? defaultThreshold : options.autoAnnotateThreshold
  if (typeof enabled !== "boolean") throw new Error("autoAnnotate must be true or false.")
  if (!Number.isSafeInteger(threshold) || threshold < 0) {
    throw new Error("autoAnnotateThreshold must be a non-negative integer (characters).")
  }
  return { enabled, threshold }
}

export function createAutoReview(context, review) {
  let config
  try {
    config = autoReviewOptions(context.options)
  } catch (error) {
    context.ui.toast.show({
      title: "Annotate", message: error.message, variant: "error", duration: 15000,
    })
    return () => {}
  }
  if (!config.enabled) return () => {}

  // Reloading configuration must not offer the same completed reply again.
  const [state, update] = context.storage.memory("auto-review", { initial: { handled: {} } })
  const pending = new Map()
  let disposed = false
  const clear = event => pending.delete(event.data.sessionID)
  const stops = [
    context.data.on("session.step.ended", event => {
      const { sessionID, assistantMessageID, finish } = event.data
      pending.delete(sessionID)
      const route = context.ui.router.current()
      if (route.type !== "session" || route.sessionID !== sessionID) return
      if (["tool-calls", "error", "content-filter"].includes(finish)) return
      pending.set(sessionID, assistantMessageID)
    }),
    context.data.on("session.execution.succeeded", async event => {
      if (disposed) return
      const { sessionID } = event.data
      const messageID = pending.get(sessionID)
      if (!messageID) return
      const key = `${sessionID}:${messageID}`
      if (state.handled[key]) return
      // Claim before awaiting: duplicate events and dismissal must not reopen it.
      update(draft => { draft.handled[key] = true })
      // Let the host apply its idle status before checking whether it is safe to open.
      await Promise.resolve()
      const current = () => !disposed && pending.get(sessionID) === messageID
      if (current()) await review.auto(sessionID, messageID, config.threshold, current)
      if (current()) pending.delete(sessionID)
    }),
    context.data.on("session.execution.started", clear),
    context.data.on("session.execution.failed", clear),
    context.data.on("session.execution.interrupted", clear),
    context.data.on("session.deleted", clear),
  ]
  return () => {
    disposed = true
    pending.clear()
    for (const stop of stops) stop()
  }
}
