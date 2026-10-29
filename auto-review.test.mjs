import assert from "node:assert/strict"
import { test } from "node:test"
import { autoReviewOptions, createAutoReview } from "./auto-review.mjs"

function fixture(options = { autoAnnotate: true }) {
  const listeners = new Map(), stores = new Map(), calls = [], notices = []
  let route = { type: "session", sessionID: "ses_visible" }
  const context = {
    options,
    storage: { memory(key, { initial }) {
      if (!stores.has(key)) stores.set(key, initial)
      const state = stores.get(key)
      return [state, mutate => mutate(state)]
    } },
    data: { on(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(handler)
      return () => listeners.get(type).delete(handler)
    } },
    ui: { router: { current: () => route }, toast: { show: notice => notices.push(notice) } },
  }
  const review = { async auto(...args) { calls.push(args) } }
  const emit = (type, data) => Promise.all([...listeners.get(type) ?? []].map(handler => handler({ type, data })))
  const step = (assistantMessageID = "msg_reply", finish = "stop", sessionID = "ses_visible") =>
    emit("session.step.ended", { sessionID, assistantMessageID, finish })
  const succeeded = (sessionID = "ses_visible") => emit("session.execution.succeeded", { sessionID })
  return {
    context, review, calls, notices, listeners, emit, step, succeeded,
    route: value => { route = value },
    start: () => createAutoReview(context, review),
  }
}

test("auto-review is opt-in, with a configurable non-negative character threshold", () => {
  assert.deepEqual(autoReviewOptions({}), { enabled: false, threshold: 2000 })
  assert.deepEqual(autoReviewOptions({ autoAnnotate: true }), { enabled: true, threshold: 2000 })
  assert.deepEqual(autoReviewOptions({ autoAnnotate: true, autoAnnotateThreshold: 0 }), { enabled: true, threshold: 0 })
  for (const autoAnnotate of ["true", 1, null, {}]) {
    assert.throws(() => autoReviewOptions({ autoAnnotate }), /autoAnnotate must/)
  }
  for (const autoAnnotateThreshold of ["2000", -1, 1.5, null, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => autoReviewOptions({ autoAnnotateThreshold }), /autoAnnotateThreshold must/)
  }
})

test("disabled or invalid configuration installs no automatic event handlers", async () => {
  for (const options of [{}, { autoAnnotate: false }, { autoAnnotate: "yes" }]) {
    const h = fixture(options)
    const stop = h.start()
    await h.step()
    await h.succeeded()
    assert.equal(h.listeners.size, 0)
    assert.equal(h.calls.length, 0)
    assert.equal(h.notices.length, options.autoAnnotate === "yes" ? 1 : 0)
    stop()
  }
})

test("only a newly completed reply followed by a successful turn triggers review", async t => {
  const h = fixture({ autoAnnotate: true, autoAnnotateThreshold: 1234 })
  t.after(h.start())
  await h.succeeded() // Loading a historical/idle session offers nothing.
  await h.emit("session.text.delta", { sessionID: "ses_visible", delta: "Long streaming text" })
  assert.equal(h.calls.length, 0)
  await h.step()
  assert.equal(h.calls.length, 0, "wait for the whole turn, not just a text block")
  await h.succeeded()
  assert.deepEqual(h.calls[0].slice(0, 3), ["ses_visible", "msg_reply", 1234])
  await h.succeeded()
  await h.step()
  await h.succeeded()
  assert.equal(h.calls.length, 1, "duplicate events must not reopen a dismissed reply")
  await h.step("msg_next")
  await h.succeeded()
  assert.equal(h.calls.length, 2)
})

test("progress, errors, failed/interrupted turns and background sessions never open", async t => {
  const h = fixture()
  t.after(h.start())
  for (const finish of ["tool-calls", "error", "content-filter"]) {
    await h.step("msg_" + finish, finish)
    await h.succeeded()
  }
  for (const type of ["session.execution.failed", "session.execution.interrupted", "session.execution.started", "session.deleted"]) {
    await h.step("msg_" + type)
    await h.emit(type, { sessionID: "ses_visible" })
    await h.succeeded()
  }
  await h.step("msg_background", "stop", "ses_other")
  await h.succeeded("ses_other")
  h.route({ type: "home" })
  await h.step()
  await h.succeeded()
  assert.equal(h.calls.length, 0)
})

test("reload retains deduplication, unsubscribes, and never replays existing replies", async () => {
  const h = fixture()
  const stop = h.start()
  await h.step()
  await h.succeeded()
  stop()
  assert.ok([...h.listeners.values()].every(handlers => handlers.size === 0))
  const stopAgain = h.start()
  await h.step()
  await h.succeeded()
  assert.equal(h.calls.length, 1)
  await h.step("msg_new")
  await h.succeeded()
  assert.equal(h.calls.length, 2)
  stopAgain()
})

test("a new execution or disposal invalidates an automatic review still loading", async () => {
  for (const dispose of [false, true]) {
    const h = fixture()
    const stop = h.start()
    let entered, release
    const loading = new Promise(resolve => { entered = resolve })
    const loaded = new Promise(resolve => { release = resolve })
    h.review.auto = async (_session, _message, _threshold, current) => {
      assert.equal(current(), true)
      entered()
      await loaded
      assert.equal(current(), false)
    }
    await h.step()
    const running = h.succeeded()
    await loading
    if (dispose) stop()
    else await h.emit("session.execution.started", { sessionID: "ses_visible" })
    release()
    await running
    stop()
  }
})
