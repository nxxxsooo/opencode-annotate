import { HOST, PROTOCOL, pageTitle, safeUrl, validateReview } from "./protocol.mjs"

const pageKey = async url => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url)))].map(v => v.toString(16).padStart(2, "0")).join("")
let writes = Promise.resolve()
const serial = fn => { const next = writes.then(fn); writes = next.catch(() => {}); return next }
const RECONNECT = "This page reloaded. Click the Annotate icon (Alt+Shift+A) once to reconnect it; your notes are kept."
const KEPT_ROUNDS = 10
const inject = tabId => chrome.scripting.executeScript({ target: { tabId }, files: ["inspector.js", "capture.js"] })
async function activate(tab) {
  if (!tab?.id || !/^(https?|file):/.test(tab.url || "")) throw new Error("Open an ordinary webpage or authorized local HTML")
  await inject(tab.id)
  await chrome.storage.session.set({ [`tab:${tab.id}`]: { page: { url: safeUrl(tab.url), title: pageTitle(tab.title || "") }, anchor: null } })
}
// A reload or navigation removes the page tools; reinject them while activeTab still grants this tab.
async function tabMessage(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message) }
  catch (error) {
    if (!String(error.message).includes("Receiving end does not exist")) throw error
    try { await inject(tabId) } catch (injectError) {
      throw new Error(String(injectError.message).includes("HTML") ? injectError.message : RECONNECT)
    }
    return chrome.tabs.sendMessage(tabId, message)
  }
}
const delivered = note => !note.deleted && note.sentRevision === note.revision
async function closeRound(hash, annotations, details) {
  const storage = await chrome.storage.local.get(null), sentAt = new Date().toISOString(), updates = {}
  for (const sent of annotations) {
    const key = `note:${hash}:${sent.id}`, note = storage[key]
    if (note && !note.deleted && note.revision === sent.revision) updates[key] = { ...note, sentRevision: sent.revision, sentAt, ...details }
  }
  await chrome.storage.local.set(updates)
  const rounds = new Map()
  for (const [key, note] of Object.entries({ ...storage, ...updates })) {
    if (!key.startsWith(`note:${hash}:`) || !delivered(note)) continue
    const id = note.sentRound || "legacy"
    if (!rounds.has(id)) rounds.set(id, { at: note.sentAt || "", keys: [] })
    rounds.get(id).keys.push(key)
  }
  const expired = [...rounds.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(KEPT_ROUNDS).flatMap(round => round.keys)
  if (expired.length) await chrome.storage.local.remove(expired)
  return Object.keys(updates).length
}
function lastRound(entries) {
  const rounds = new Map()
  for (const note of entries) {
    if (!delivered(note) || !note.sentRound) continue
    const round = rounds.get(note.sentRound) || { id: note.sentRound, count: 0, at: note.sentAt, via: note.sentVia, to: note.sentTo }
    round.count++; rounds.set(note.sentRound, round)
  }
  return [...rounds.values()].sort((a, b) => b.at.localeCompare(a.at))[0] || null
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
  const entries = Object.entries(storage).filter(([key]) => key.startsWith(`note:${hash}:`)).map(([, value]) => value)
  // Delivered notes leave the working list; the latest rounds stay restorable.
  const notes = entries.filter(note => !note.deleted && !delivered(note)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const draft = storage[`draft:${hash}`] || { revision: 0, value: null }
  const outbox = storage[`outbox:${hash}`]
  let anchorStates = notes.map(() => "unavailable"), draftAnchorState = draft.value ? "unavailable" : undefined, detached = null
  try {
    const anchors = notes.map(note => note.anchor).concat(draft.value ? [draft.value.anchor] : [])
    const { states } = await tabMessage(tab.id, { action: "locate", anchors })
    anchorStates = states.slice(0, notes.length)
    if (draft.value) draftAnchorState = states[notes.length]
  } catch (error) { if (error.message === RECONNECT) detached = RECONNECT /* otherwise visibly unavailable while navigating */ }
  return { protocol: PROTOCOL, tabID: tab.id, ...state, notes, anchorStates, hash, draft, draftAnchorState, detached, lastRound: lastRound(entries),
    outbox: outbox ? { targetID: outbox.targetID, count: outbox.review.annotations.length } : null }
}
function draftConflict(draft) {
  return Object.assign(new Error("This draft changed in another panel. Choose which version to keep."), { code: "draft-conflict", draft })
}
function validateDraft(page, draft) {
  if (draft === null) return
  if (!draft || typeof draft.comment !== "string" || draft.comment.length > 8000 || !["comment", "ask"].includes(draft.kind)) throw new Error("Invalid draft")
  validateReview({ version: 1, page, annotations: [{ id: "draft", revision: 1, createdAt: new Date().toISOString(),
    kind: draft.kind, comment: draft.comment.trim() || "Draft", anchor: draft.anchor }] })
  if (draft.editing) validateReview({ version: 1, page, annotations: [draft.editing] })
  consumedCaptures({}, draft.captures)
}
function consumedCaptures(previous, captures) {
  const result = { ...previous }
  if (!captures) return result
  if (typeof captures !== "object" || Array.isArray(captures)) throw new Error("Invalid capture acknowledgement")
  for (const [tab, id] of Object.entries(captures)) {
    if (!Number.isSafeInteger(Number(tab)) || Number(tab) < 0 || String(Number(tab)) !== tab || typeof id !== "string" || !id) throw new Error("Invalid capture acknowledgement")
    result[tab] = id
  }
  return result
}
async function handle(message, sender) {
  if (message.action === "capture") {
    if (!sender.tab || !sender.url || new URL(message.page.url).origin !== new URL(sender.url).origin) throw new Error("Invalid page source")
    const key = `tab:${sender.tab.id}`
    const previous = (await chrome.storage.session.get(key))[key] || {}
    await chrome.storage.session.set({ [key]: { ...previous, page: { url: safeUrl(message.page.url), title: pageTitle(message.page.title) }, picking: !!message.picking,
      ...(!message.modeOnly ? { anchor: message.anchor, error: message.error, captureID: crypto.randomUUID() } : {}) } })
    return {}
  }
  if (sender.url && !sender.url.startsWith(chrome.runtime.getURL(""))) throw new Error("Only the extension panel can manage feedback")
  if (message.action === "current") return current()
  if (message.action === "draft") return serial(async () => {
    // A route change must still be able to persist the previous page's draft.
    if (!message.page || safeUrl(message.page.url) !== message.page.url || typeof message.page.title !== "string" ||
        typeof message.writerID !== "string" || !message.writerID || !Number.isSafeInteger(message.sequence) || message.sequence < 1 ||
        !Number.isSafeInteger(message.baseRevision) || message.baseRevision < 0) throw new Error("Invalid draft update")
    validateDraft(message.page, message.value)
    const key = `draft:${await pageKey(message.page.url)}`
    const old = (await chrome.storage.local.get(key))[key] || { revision: 0, value: null }
    if (old.writerID === message.writerID && old.sequence >= message.sequence) return { draft: old }
    if (old.revision !== message.baseRevision && old.writerID !== message.writerID) throw draftConflict(old)
    const draft = { revision: old.revision + 1, value: message.value, writerID: message.writerID,
      consumedCaptures: consumedCaptures(old.consumedCaptures, message.value === null ? message.captures : null),
      sequence: message.sequence, updatedAt: new Date().toISOString() }
    await chrome.storage.local.set({ [key]: draft })
    return { draft }
  })
  if (message.action === "targets") return chrome.runtime.sendNativeMessage(HOST, { action: "targets" })
  if (message.action === "connection") {
    const { paired } = await chrome.storage.local.get("paired")
    let result
    try {
      result = await chrome.runtime.sendNativeMessage(HOST, { action: "targets" })
      if (!result.ok) throw new Error(result.error)
    } catch (error) {
      return { targets: [], target: null, destination: paired || null, stale: !!paired, error: error.message }
    }
    const target = paired ? result.targets.find(target => target.id === paired.id) : result.targets.length === 1 ? result.targets[0] : null
    return { targets: result.targets, target: target || null, destination: target || paired || null, stale: !!paired && !target }
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
  if (message.action === "pick") return tabMessage(state.tabID, { action: "pick" })
  if (message.action === "reveal") {
    const note = state.notes.find(note => note.id === message.noteID)
    if (!note) throw new Error("This note is no longer on the page")
    const result = await tabMessage(state.tabID, { action: "reveal", anchor: note.anchor })
    if (!result.ok) throw new Error(result.error)
    return result
  }
  if (["save", "delete", "restore"].includes(message.action)) return serial(async () => {
    const key = `note:${state.hash}:${message.note.id}`
    const old = (await chrome.storage.local.get(key))[key]
    if ((old?.revision || 0) !== message.baseRevision) throw Object.assign(new Error("This note changed in another tab. Choose which version to keep."), { code: "note-conflict", note: old || null })
    if (message.action !== "save" && !old) throw new Error("This note no longer exists")
    if (message.action === "restore" && !old.deleted) throw new Error("This note has already been restored")
    if (old && delivered(old)) throw new Error("This note was already delivered; restore its round first")
    const note = { ...(message.action === "save" ? message.note : old), page: state.page,
      revision: (old?.revision || 0) + 1, deleted: message.action === "delete" }
    if (message.action === "save") note.sentRevision = old?.sentRevision
    validateReview({ version: 1, page: state.page, annotations: [note] })
    if (!old && state.notes.length >= 200) throw new Error("This page has 200 notes; export and remove some first")
    const updates = { [key]: note }
    let draft
    if (message.draftRevision !== undefined) {
      const draftKey = `draft:${state.hash}`
      const previous = (await chrome.storage.local.get(draftKey))[draftKey] || { revision: 0, value: null }
      if (previous.revision !== message.draftRevision) throw draftConflict(previous)
      draft = { ...previous, revision: previous.revision + 1, value: null,
        consumedCaptures: consumedCaptures(previous.consumedCaptures, message.captures), updatedAt: new Date().toISOString() }
      updates[draftKey] = draft
    }
    await chrome.storage.local.set(updates); return { note, draft }
  })
  if (message.action === "markers") return tabMessage(state.tabID, { action: "markers", notes: state.notes.map(note => ({ anchor: note.anchor })) })
  if (message.action === "copied") return serial(async () => {
    if (!Array.isArray(message.notes) || !message.notes.length) throw new Error("No copied feedback to record")
    const count = await closeRound(state.hash, message.notes, { sentRound: crypto.randomUUID(), sentVia: "clipboard", sentTo: null })
    // Copied feedback supersedes a batch that could not reach its session.
    await chrome.storage.local.remove(`outbox:${state.hash}`)
    return { count }
  })
  if (message.action === "restore-round") return serial(async () => {
    const storage = await chrome.storage.local.get(null), updates = {}
    for (const [key, note] of Object.entries(storage)) {
      if (!key.startsWith(`note:${state.hash}:`) || !delivered(note) || note.sentRound !== message.roundID) continue
      const { sentRevision, sentRound, sentAt, sentVia, sentTo, ...rest } = note
      updates[key] = { ...rest, revision: note.revision + 1 }
    }
    if (!Object.keys(updates).length) throw new Error("This round is no longer available")
    if (state.notes.length + Object.keys(updates).length > 200) throw new Error("This page would exceed 200 notes; send or remove some first")
    await chrome.storage.local.set(updates)
    return { count: Object.keys(updates).length }
  })
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
    const count = await closeRound(state.hash, batch.review.annotations, { sentRound: batch.batchID, sentVia: "session", sentTo: paired.title })
    await chrome.storage.local.remove(outboxKey)
    return { ...response, count }
  })
  throw new Error("Unknown annotation action")
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message, code: error.code, draft: error.draft, note: error.note }))
  return true
})
