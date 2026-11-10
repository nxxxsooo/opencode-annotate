import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { openPanel, panelWindowID, panelPolling, sameExtensionURL, sessionDelivery, resolveTargetTab } from "./browser/env.mjs"

test("Safari popup, worker and local round lifecycle stay isolated from native delivery", async () => {
  const previous = { chrome: globalThis.chrome, document: globalThis.document, location: globalThis.location }
  const local = {}, session = {}, queries = [], windows = [], messages = []
  let receive, clicked, nativeCalls = 0, injections = 0, missing = false
  const storage = data => ({
    async get(key) { return structuredClone(key === null ? data : Object.fromEntries([key].filter(k => k in data).map(k => [k, data[k]]))) },
    async set(values) { Object.assign(data, structuredClone(values)) },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key] },
  })
  globalThis.chrome = {
    runtime: {
      getURL: file => `safari-web-extension://ABC/${file.replace(/^\//, "")}`,
      sendNativeMessage() { nativeCalls++; throw new Error("Safari must never call native messaging") },
      onMessage: { addListener(fn) { receive = fn } },
    },
    action: { onClicked: { addListener(fn) { clicked = fn } } },
    storage: { local: storage(local), session: storage(session) },
    windows: { async create(options) { windows.push(options); return options } },
    tabs: {
      async query(query) { queries.push(query); return [{ id: query.windowId === 7 ? 42 : 999 }] },
      async sendMessage(id, message) {
        messages.push([id, message])
        if (missing) throw new Error("Safari receiver unavailable")
        return message.action === "locate" ? { states: message.anchors.map(() => "located") } : { ok: true }
      },
    },
    scripting: { async executeScript() { injections++; missing = false } },
  }
  try {
    assert.equal(sessionDelivery(), false)
    assert.equal(sameExtensionURL("safari-web-extension://abc/panel.html"), true)
    assert.equal(sameExtensionURL("safari-web-extension://abd/panel.html"), false)
    assert.equal(sameExtensionURL("https://abc/panel.html"), false)
    globalThis.location = { search: "?window=7" }
    assert.equal(panelWindowID(), 7)
    for (const search of ["", "?window=-1", "?window=no", "?window=1.5"]) {
      globalThis.location.search = search; assert.equal(panelWindowID(), undefined)
    }
    globalThis.document = { visibilityState: "hidden" }
    assert.equal(panelPolling(), true, "unfocused Safari popups keep polling selections")
    await openPanel({ id: 42, windowId: 7 })
    assert.equal(new URL(windows[0].url).searchParams.get("window"), "7")
    assert.equal(windows[0].type, "popup")
    await import(`./browser/worker.mjs?safari-test=${Date.now()}`)
    const call = (action, extra = {}, sender = { url: "safari-web-extension://abc/panel.html" }) => new Promise(resolve => {
      assert.equal(receive({ action, windowID: 7, ...extra }, sender, resolve), true)
    })
    const page = { url: "https://example.test/review", title: "Review" }
    session["tab:42"] = { page, anchor: null }
    assert.equal((await call("connection")).delivery, false)
    assert.equal((await call("targets")).ok, false)
    assert.equal((await call("pair", { target: { id: "no" } })).ok, false)
    assert.equal((await call("current")).tabID, 42)
    assert.deepEqual(queries.at(-1), { active: true, windowId: 7 })
    const note = { id: "note1", revision: 1, createdAt: new Date().toISOString(), kind: "comment", comment: "Fix this", anchor: { type: "text", selector: "p", quote: "Text", prefix: "", suffix: "" } }
    const saved = await call("save", { note, baseRevision: 0 })
    assert.equal(saved.ok, true, saved.error)
    let current = await call("current")
    assert.equal(current.notes.length, 1)
    const copy = await call("copied", { notes: [{ id: "note1", revision: 1 }] })
    assert.equal(copy.count, 1)
    current = await call("current")
    assert.equal(current.notes.length, 0)
    assert.equal(current.lastRound.via, "clipboard")
    assert.equal((await call("restore-round", { roundID: current.lastRound.id })).count, 1)
    current = await call("current")
    assert.equal(current.notes[0].revision, 2)
    assert.equal((await call("send", { targetID: "no" })).ok, false)
    assert.equal(nativeCalls, 0)
    missing = true
    await call("current")
    assert.equal(injections, 1)
    assert.ok(messages.some(([, message]) => message.action === "annotate-ping"))
    assert.equal((await call("current", {}, { url: "https://example.test/" })).ok, false)
    assert.equal(typeof clicked, "function")
    chrome.runtime.getURL = file => `chrome-extension://abc/${file}`
    assert.equal(sessionDelivery(), true)
    assert.equal(panelPolling(), false)
    document.visibilityState = "visible"
    assert.equal(panelPolling(), true)
    await resolveTargetTab({})
    assert.deepEqual(queries.at(-1), { active: true, lastFocusedWindow: true })
    let opened
    chrome.sidePanel = { async open(options) { opened = options } }
    await openPanel({ id: 42, windowId: 7 })
    assert.deepEqual(opened, { tabId: 42 })
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
})
test("Safari popup creation failure fails fast without opening a tab in the source window", async () => {
  const previous = globalThis.chrome
  let tabCreates = 0
  globalThis.chrome = {
    runtime: { getURL: file => `safari-web-extension://ABC/${file}` },
    windows: { async create() { throw new Error("Popup creation denied") } },
    tabs: { async create() { tabCreates++ } },
  }
  try {
    await assert.rejects(openPanel({ id: 42, windowId: 7 }), {
      message: "Could not open the Safari annotation window: Popup creation denied",
    })
    assert.equal(tabCreates, 0, "the panel must never replace the reviewed window's active tab")
  } finally {
    if (previous === undefined) delete globalThis.chrome
    else globalThis.chrome = previous
  }
})
test("panel attaches popup window binding, polls while unfocused and copies with existing controls", async () => {
  const source = await readFile(new URL("./browser/panel.mjs", import.meta.url), "utf8")
  assert.match(source, /sendMessage\(windowID === undefined \? data : \{ \.\.\.data, windowID \}\)/)
  assert.match(source, /if \(!deliverySupported\) return copyRound\(\)/)
  assert.equal((source.match(/if \(panelPolling\(\)\)/g) || []).length, 2)
})
