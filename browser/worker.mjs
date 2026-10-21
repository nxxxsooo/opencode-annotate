import { HOST, safeUrl, validateReview } from "./protocol.mjs"

const pageKey = async url => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url)))].map(v => v.toString(16).padStart(2, "0")).join("")
let writes = Promise.resolve()
const serial = fn => { const next = writes.then(fn); writes = next.catch(() => {}); return next }
async function activate(tab) {
  if (!tab?.id || !/^(https?|file):/.test(tab.url || "")) throw new Error("Open an ordinary webpage or authorized local HTML")
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["inspector.js", "capture.js"] })
  await chrome.storage.session.set({ [`tab:${tab.id}`]: { page: { url: safeUrl(tab.url), title: tab.title || "Page" }, anchor: null } })
}
chrome.action.onClicked.addListener(tab => {
  // open() must retain the browser's action user gesture, before asynchronous injection.
  chrome.sidePanel.open({ tabId: tab.id }).catch(console.error)
  activate(tab).catch(async error => { await chrome.storage.session.set({ [`tab:${tab.id}`]: { error: error.message } }) })
})
async function current() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab) throw new Error("No active page")
  const state = (await chrome.storage.session.get(`tab:${tab.id}`))[`tab:${tab.id}`]
  if (!state?.page) throw new Error(state?.error || "Click the extension icon on this page to grant access")
  const hash = await pageKey(state.page.url)
  const storage = await chrome.storage.local.get(null)
  const notes = Object.entries(storage).filter(([key, value]) => key.startsWith(`note:${hash}:`) && !value.deleted).map(([, value]) => value).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  let anchorStates = notes.map(() => "unavailable")
  try { anchorStates = (await chrome.tabs.sendMessage(tab.id, { action: "locate", anchors: notes.map(note => note.anchor) })).states } catch { /* visibly unavailable while navigating */ }
  return { tabID: tab.id, ...state, notes, anchorStates, hash }
}
async function handle(message, sender) {
  if (message.action === "capture") {
    if (!sender.tab || !sender.url || new URL(message.page.url).origin !== new URL(sender.url).origin) throw new Error("Invalid page source")
    const key = `tab:${sender.tab.id}`
    const previous = (await chrome.storage.session.get(key))[key] || {}
    await chrome.storage.session.set({ [key]: { ...previous, page: { url: safeUrl(message.page.url), title: String(message.page.title).slice(0, 500) }, picking: !!message.picking,
      ...(!message.modeOnly ? { anchor: message.anchor, error: message.error } : {}) } })
    return {}
  }
  if (sender.url && !sender.url.startsWith(chrome.runtime.getURL(""))) throw new Error("Only the extension panel can manage feedback")
  if (message.action === "current") return current()
  if (message.action === "targets") return chrome.runtime.sendNativeMessage(HOST, { action: "targets" })
  if (message.action === "connection") {
    const result = await chrome.runtime.sendNativeMessage(HOST, { action: "targets" })
    if (!result.ok) throw new Error(result.error)
    const { paired } = await chrome.storage.local.get("paired")
    const target = paired ? result.targets.find(target => target.id === paired.id) : result.targets.length === 1 ? result.targets[0] : null
    return { targets: result.targets, target: target || null, stale: !!paired && !target }
  }
  if (message.action === "pair") {
    const result = await chrome.runtime.sendNativeMessage(HOST, { action: "info", targetID: message.target.id })
    if (!result.ok) throw new Error(result.error)
    await chrome.storage.local.set({ paired: result.target }); return { target: result.target }
  }
  if (message.action === "pairing") return { target: (await chrome.storage.local.get("paired")).paired || null }
  if (message.action === "unpair") { await chrome.storage.local.remove("paired"); return {} }
  const state = await current()
  if (message.url && message.url !== state.page.url) throw new Error("The active page changed; retry on the original page")
  if (message.action === "pick") return chrome.tabs.sendMessage(state.tabID, { action: "pick" })
  if (message.action === "save" || message.action === "delete") return serial(async () => {
    const key = `note:${state.hash}:${message.note.id}`
    const old = (await chrome.storage.local.get(key))[key]
    if ((old?.revision || 0) !== message.baseRevision) throw new Error("This note changed in another tab; refresh and retry")
    const note = { ...message.note, page: state.page, revision: (old?.revision || 0) + 1, deleted: message.action === "delete" }
    validateReview({ version: 1, page: state.page, annotations: [note] })
    if (!old && state.notes.length >= 200) throw new Error("This page has 200 notes; export and remove some first")
    await chrome.storage.local.set({ [key]: note }); return { note }
  })
  if (message.action === "markers") return chrome.tabs.sendMessage(state.tabID, { action: "markers", notes: state.notes.map(note => ({ anchor: note.anchor })) })
  if (message.action === "send") return serial(async () => {
    const latest = await current()
    if (latest.page.url !== state.page.url) throw new Error("The active page changed; return to the original page to send")
    if (typeof message.targetID !== "string" || !message.targetID) throw new Error("Choose a destination session before sending")
    let { paired } = await chrome.storage.local.get("paired")
    if (paired && paired.id !== message.targetID) throw new Error("The destination changed in another panel; choose it again")
    if (!paired) {
      // A sole target is only preselected. The user's Send click authorizes this binding.
      const result = await chrome.runtime.sendNativeMessage(HOST, { action: "info", targetID: message.targetID })
      if (!result.ok) throw new Error(result.error)
      paired = result.target
      await chrome.storage.local.set({ paired })
    }
    const outboxKey = `outbox:${state.hash}`
    let batch = (await chrome.storage.local.get(outboxKey))[outboxKey]
    if (batch && batch.targetID !== paired.id) throw new Error("An unsent batch belongs to the previous pairing; restore that pairing or export your notes")
    if (!batch) {
      const pending = latest.notes.filter(note => note.sentRevision !== note.revision)
      if (!pending.length) throw new Error("No new feedback to send")
      const review = validateReview({ version: 1, page: state.page, annotations: pending })
      batch = { action: "send", batchID: crypto.randomUUID(), targetID: paired.id, review }
      await chrome.storage.local.set({ [outboxKey]: batch })
    }
    const response = await chrome.runtime.sendNativeMessage(HOST, batch)
    if (!response.ok) throw new Error(response.error)
    for (const sent of batch.review.annotations) {
      const key = `note:${state.hash}:${sent.id}`
      const note = (await chrome.storage.local.get(key))[key]
      if (note && note.revision === sent.revision) await chrome.storage.local.set({ [key]: { ...note, sentRevision: sent.revision } })
    }
    await chrome.storage.local.remove(outboxKey)
    return response
  })
  throw new Error("Unknown annotation action")
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }))
  return true
})
