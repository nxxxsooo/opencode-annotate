import assert from "node:assert/strict"
import { test } from "node:test"
import { configurationRPC, registerConfiguration, watchConfiguration } from "./configuration.mjs"

function fixture({ options = {}, get = async () => ({ autoAnnotate: true }) } = {}) {
  const listeners = new Map(), applied = [], notices = [], requests = []
  const context = {
    options, location: { directory: "/project" },
    client: { rpc(definition) {
      assert.equal(definition, configurationRPC)
      return { async get(input, request) { requests.push(request); return get(input, request) } }
    } },
    data: { on(type, handler) { listeners.set(type, handler); return () => listeners.delete(type) } },
    ui: { toast: { show: notice => notices.push(notice) } },
  }
  return { context, applied, notices, requests, listeners, start: () => watchConfiguration(context, value => applied.push(value)) }
}

test("server configuration RPC exposes this plugin's options only", async () => {
  const options = { autoAnnotate: true, autoAnnotateThreshold: 700, inheritTheme: true }
  let handler
  await registerConfiguration({ options, rpc: { async register(definition, handlers) {
    assert.equal(definition, configurationRPC)
    handler = handlers.get
    return { events: { async emit(name, data) {
      assert.equal(name, "updated")
      assert.deepEqual(data, {})
    } } }
  } } })
  assert.deepEqual(await handler(), options)
})

test("TUI reads options at its own location and preserves explicit local overrides", async t => {
  const h = fixture({ options: { autoAnnotate: false }, get: async () => ({ autoAnnotate: true, autoAnnotateThreshold: 800 }) })
  const config = h.start()
  t.after(config.dispose)
  await config.ready
  assert.deepEqual(h.applied, [{ autoAnnotate: false, autoAnnotateThreshold: 800 }])
  assert.deepEqual(h.requests[0].location, { directory: "/project" })
  assert.equal(h.requests[0].signal.aborted, false)
})

test("CLI-only configuration works without a server; other errors are visible", async () => {
  for (const type of ["rpc.unavailable", "rpc.invalid_input"]) {
    const h = fixture({ options: { autoAnnotate: true }, get: async () => { throw { type, message: "failure" } } })
    const config = h.start()
    await config.ready
    assert.equal(h.applied.length, type === "rpc.unavailable" ? 1 : 0)
    assert.equal(h.notices.length, type === "rpc.unavailable" ? 0 : 1)
    config.dispose()
  }
})

test("config refresh discards stale responses and aborts loading on disposal", async () => {
  const responses = []
  const h = fixture({ get: () => new Promise(resolve => responses.push(resolve)) })
  const config = h.start()
  h.listeners.get("rpc.annotate.configuration.updated")({})
  assert.equal(h.requests[0].signal.aborted, true)
  responses[1]({ autoAnnotate: false })
  await new Promise(resolve => setImmediate(resolve))
  responses[0]({ autoAnnotate: true })
  await config.ready
  assert.deepEqual(h.applied, [{ autoAnnotate: false }])
  h.listeners.get("plugin.updated")({})
  config.dispose()
  responses[2]({ autoAnnotate: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.requests[2].signal.aborted, true)
  assert.deepEqual(h.applied, [{ autoAnnotate: false }])
  assert.equal(h.listeners.size, 0)
  assert.deepEqual(h.notices, [])
})
