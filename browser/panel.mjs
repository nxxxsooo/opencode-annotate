import { PROTOCOL, markdown, validateReview } from "./protocol.mjs"
import { panelPolling, panelWindowID } from "./env.mjs"

const $ = id => document.getElementById(id)
const make = (tag, text = "") => { const node = document.createElement(tag); node.textContent = text; return node }
const clone = value => structuredClone(value)
const writerID = crypto.randomUUID(), models = new Map(), busy = new Set()
// Safari hosts the panel in its own window; the reviewed page is the active tab of
// the window the panel was opened for, so the worker needs that window id.
const windowID = panelWindowID()
let state, model, destination, available, targets = [], workspaces = [], disconnected = false, connectionError = "", connectionLoading = true
// Safari has no reachable bridge, so the panel offers copy instead of session delivery.
let deliverySupported = true
let refreshID = 0, connectionRevision = 0, connectionRefresh, connectionRefreshRevision, connectionTimer, scheduledRefresh
let pendingAction, pendingFocus, undoRecord, clearBatchID, selectedNoteID, noteRenderKey, notice, outdated = false
let sessionSort = localStorage.getItem("sessionSort") || "updated", showAllSessions = false

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("class", "icon"); svg.setAttribute("aria-hidden", "true")
  const use = document.createElementNS(svg.namespaceURI, "use"); use.setAttribute("href", `#icon-${name}`)
  svg.append(use); return svg
}
async function call(data) {
  const result = await chrome.runtime.sendMessage(windowID === undefined ? data : { ...data, windowID })
  if (result?.error === "Unknown annotation action") throw markOutdated()
  if (!result?.ok) throw Object.assign(new Error(result?.error || "Extension disconnected; reopen the panel"), { code: result?.code, draft: result?.draft, note: result?.note })
  return result
}
function markOutdated() {
  outdated = true; $("update-notice").hidden = false; controls()
  return Object.assign(new Error("Annotate was updated"), { code: "outdated" })
}
const plural = count => `${count} note${count === 1 ? "" : "s"}`
function status(text, tone = "", page = state?.page.url) { notice = text ? { text, tone, page } : null; renderDelivery() }
function focusWhenReady(selector, scroll = true) {
  pendingFocus = { selector, scroll, page: state?.page.url }
  flushFocus()
}
function flushFocus() {
  if (!pendingFocus) return false
  const request = pendingFocus, node = document.querySelector(request.selector)
  if (request.page !== state?.page.url || !node || !node.getClientRects().length) { pendingFocus = null; return false }
  if (node.disabled && busy.size) return false
  pendingFocus = null
  if (node.disabled) return false
  node.focus({ preventScroll: true })
  if (request.scroll) node.scrollIntoView({ block: "nearest" })
  return true
}
async function run(id, fn) {
  if (busy.has(id)) return
  const previousFocus = document.activeElement, page = state?.page.url
  busy.add(id); controls()
  try { await fn() }
  catch (error) {
    if (error.code === "outdated") return
    if (model && ["draft-conflict", "note-conflict"].includes(error.code)) {
      model.conflict = error; model.error = error
      renderComposer()
    }
    status(error.message, "error", ["send", "copy-round", "restore-round", "undo", "delete", "clear"].includes(id) ? null : page)
  } finally {
    busy.delete(id); if ($(id)) $(id).disabled = false; controls()
    if (!flushFocus() && !pendingFocus && document.activeElement === document.body && page === state?.page.url &&
        previousFocus?.isConnected && !previousFocus.disabled && previousFocus.getClientRects().length) previousFocus.focus({ preventScroll: true })
  }
}
const task = (id, fn) => $(id).addEventListener("click", () => run(id, fn))
function dirty(m = model) {
  const value = m?.value
  if (!value) return false
  return value.editing ? value.comment.trim() !== value.editing.comment || value.kind !== value.editing.kind ||
    anchorIdentity(value.anchor) !== anchorIdentity(value.editing.anchor) : !!value.comment.trim()
}
const validDraft = () => !!model?.value?.comment.trim() && dirty()
const anchorIdentity = anchor => anchor ? JSON.stringify([anchor.frame, anchor.type, anchor.selector, anchor.quote, anchor.prefix, anchor.suffix]) : ""
function pendingCount() {
  const pending = state?.notes.filter(note => note.sentRevision !== note.revision) || []
  return pending.length + (validDraft() && !pending.some(note => note.id === model.value.editing?.id) ? 1 : 0)
}
function locked() { return ["clear", "save", "send", "copy-round", "restore-round", "cancel", "save-switch", "discard-switch", "delete", "undo", "reload-draft", "keep-draft", "targets", "new-session", "disconnect", "change-target"].some(id => busy.has(id)) }
function controls() {
  const lock = locked() || outdated
  $("comment").disabled = lock
  for (const button of $("kind").querySelectorAll("button")) button.disabled = lock
  $("save").disabled = lock || !state || !validDraft() || !!model?.conflict
  $("save-switch").disabled = lock || !validDraft() || !!model?.conflict
  $("pick").disabled = !state || lock
  $("cancel").disabled = lock
  for (const id of ["discard-switch", "keep-editing", "retry-draft", "reload-draft", "keep-draft", "copy-draft", "undo", "restore-round", "change-target"]) $(id).disabled = lock
  for (const row of $("targets").querySelectorAll(".session-row")) row.disabled = lock || !targets.some(target => target.id === row.dataset.targetId)
  for (const row of $("workspaces").querySelectorAll("button")) row.disabled = lock
  const creator = targets.find(target => target.id === destination?.id && target.canCreate)
  $("new-session").hidden = !creator
  $("new-session").disabled = lock || !creator
  $("new-session").title = creator ? `Create an empty session in ${creator.directory} with this session's model` : ""
  $("new-session").textContent = busy.has("new-session") ? "Creating session…" : "New session"
  $("disconnect").hidden = !available
  $("disconnect").disabled = lock || !available
  $("copy").disabled = $("export").disabled = !state?.notes.length
  for (const button of $("notes").querySelectorAll("button")) button.disabled = lock
  for (const id of ["clear", "confirm-clear", "cancel-clear"]) $(id).disabled = lock || !state?.notes.length
  for (const id of busy) if ($(id)) $(id).disabled = true
  if (outdated) for (const button of document.querySelectorAll("button:not(#reload-extension)")) button.disabled = true
  renderDelivery()
}

function modelFor(next) {
  let m = models.get(next.page.url)
  if (!m) {
    m = { page: next.page, hash: next.hash, record: next.draft, value: clone(next.draft.value), sequence: 0,
      acknowledged: 0, touched: false, pending: new Set(), captureID: null, error: null, conflict: null }
    models.set(next.page.url, m)
  } else mergeDraft(m, next.draft)
  return m
}
function mergeDraft(m, record) {
  if (record.revision <= m.record.revision) return
  if (record.writerID !== writerID && (m.touched || m.pending.size)) {
    m.conflict = Object.assign(new Error("This draft changed in another panel. Choose which version to keep."), { code: "draft-conflict", draft: record })
    m.error = m.conflict
    return
  }
  m.record = record
  if (!m.touched && !m.pending.size) m.value = clone(record.value)
}
function persistDraft(m, value = m.value) {
  if (m.conflict) return Promise.reject(m.conflict)
  const sequence = ++m.sequence, snapshot = clone(value)
  m.touched = true
  const promise = call({ action: "draft", page: m.page, value: snapshot, writerID, sequence, baseRevision: m.record.revision,
    ...(value === null ? { captures: m.value?.captures } : {}) })
    .then(result => {
      if (result.draft.revision > m.record.revision) m.record = result.draft
      if (sequence === m.sequence && !m.conflict) { m.acknowledged = sequence; m.error = null }
      return result.draft
    }, error => {
      if (error.code === "draft-conflict") m.conflict = error
      if (sequence === m.sequence || m.conflict) m.error = error
      throw error
    }).finally(() => {
      m.pending.delete(promise)
      if (m === model) { renderComposer(); controls() }
    })
  m.pending.add(promise)
  if (m === model) renderComposer()
  return promise
}
async function flushDraft(m) {
  await Promise.allSettled([...m.pending])
  if (m.error || m.conflict) throw m.conflict || m.error
}
function openComposer(value) {
  model.value = clone(value); model.error = null; model.conflict = null; model.touched = false
  selectedNoteID = value.editing?.id || null; pendingAction = null; notice = null
  // Selection is broadcast to every open panel. Only user edits claim a draft.
  render(); focusWhenReady("#comment")
}
async function discardDraft() {
  const m = model
  await persistDraft(m, null)
  m.value = null; m.touched = false; m.error = null
  if (model === m) { pendingAction = null; selectedNoteID = null; notice = null; render() }
}
function draftNote(value) {
  const now = new Date().toISOString()
  return { id: value.editing?.id || crypto.randomUUID(), revision: (value.editing?.revision || 0) + 1,
    page: value.editing?.page || model.page, createdAt: value.editing?.createdAt || now, updatedAt: now, kind: value.kind, comment: value.comment.trim(), anchor: value.anchor }
}
async function saveCurrent(prepared) {
  const m = model
  if (!validDraft()) return
  await flushDraft(m)
  const value = clone(m.value), note = prepared || draftNote(value)
  const result = await call({ action: "save", url: m.page.url, note, baseRevision: value.editing?.revision || 0,
    draftRevision: m.record.revision, captures: value.captures })
  m.record = result.draft; m.value = null; m.touched = false; m.error = null; m.conflict = null
  if (model === m) { pendingAction = null; selectedNoteID = result.note.id }
  await refresh(); status("Saved locally", "", m.page.url)
}
async function performAction(action) {
  pendingAction = null
  if (action.type === "select") openComposer({ anchor: action.anchor, captures: { [action.capture.tabID]: action.capture.id }, kind: "comment", comment: "", editing: null })
  else if (action.type === "edit") {
    const note = state.notes.find(note => note.id === action.id)
    if (!note) throw new Error("This note has been removed; choose another note")
    if (note.page.url !== state.page.url) {
      await call({ action: "reveal", noteID: note.id })
      await refresh()
      if (state.page.url !== note.page.url) throw new Error("Open the note's page before editing")
    }
    openComposer({ anchor: note.anchor, kind: note.kind, comment: note.comment, editing: note })
  } else if (action.type === "delete") await deleteNote(action.id)
}
async function requestAction(action) {
  if (dirty()) {
    pendingAction = action; renderComposer(); controls()
    $("switch-notice").scrollIntoView({ block: "nearest" })
  } else await performAction(action)
}
async function deleteNote(id) {
  const note = state.notes.find(note => note.id === id), m = model
  if (!note) throw new Error("This note has already been removed")
  const clearDraft = m.value?.editing?.id === id
  if (clearDraft) await flushDraft(m)
  const result = await call({ action: "delete", url: state.page.url, note, baseRevision: note.revision,
    ...(clearDraft ? { draftRevision: m.record.revision, captures: m.value.captures } : {}) })
  if (clearDraft) { m.record = result.draft; m.value = null; m.touched = false }
  undoRecord = { notes: [result.note] }
  await refresh(); focusWhenReady("#undo")
}

async function clearNotes(url, dropBatchID) {
  if (!url && state.outbox && dropBatchID !== state.outbox.batchID) {
    clearBatchID = state.outbox.batchID; $("clear-warning").hidden = false
    focusWhenReady("#confirm-clear"); return
  }
  const notes = state.notes.filter(note => !url || note.page.url === url)
  const result = await call({ action: "clear", notes: notes.map(note => ({ url: note.page.url, id: note.id, revision: note.revision })), wholeRound: !url, dropBatchID })
  undoRecord = { notes: result.notes }; clearBatchID = null; $("clear-warning").hidden = true
  await refresh(); focusWhenReady("#undo")
}

function renderComposer() {
  const value = model?.value
  $("composer").hidden = !value
  $("empty-state").hidden = !!value || !!state?.notes.length
  renderEmpty()
  if (!value) return
  $("composer-title").textContent = value.editing ? "Edit note" : "New note"
  $("quote").textContent = value.anchor.quote
  if ($("comment").value !== value.comment) $("comment").value = value.comment
  for (const button of $("kind").querySelectorAll("button")) {
    const selected = button.dataset.kind === value.kind
    button.setAttribute("aria-checked", String(selected)); button.tabIndex = selected ? 0 : -1
  }
  $("save-label").textContent = value.editing ? "Save changes" : "Add note"
  $("draft-state").textContent = model.error ? "Draft not saved" : model.pending.size ? "Saving draft…" : value.editing && !dirty() ? "No changes yet" : value.comment.trim() ? "Draft saved locally" : "Only saved on your device"
  $("switch-notice").hidden = !pendingAction
  $("switch-description").textContent = pendingAction?.type === "delete" ? "Save your changes before removing this note, or keep editing." : "Add this feedback to your notes before switching, or keep editing."
  $("save-switch").textContent = `${value.editing ? "Save" : "Add"} & ${pendingAction?.type === "delete" ? "continue" : "switch"}`
  $("discard-switch").textContent = `Discard & ${pendingAction?.type === "delete" ? "continue" : "switch"}`
  $("draft-error").hidden = !model.error
  $("draft-error-text").textContent = model.error?.message || ""
  $("retry-draft").hidden = !!model.conflict
  $("reload-draft").hidden = $("keep-draft").hidden = !model.conflict
  $("reload-draft").textContent = model.conflict?.code === "note-conflict" ? "Load saved note" : "Load saved draft"
  const anchorState = state?.draftAnchorState
  const sameStoredAnchor = anchorIdentity(state?.draft.value?.anchor) === anchorIdentity(value.anchor)
  $("anchor-warning").hidden = !sameStoredAnchor || !anchorState || anchorState === "located"
  $("anchor-warning").textContent = `Element ${anchorState}. Your draft is kept.`
}
function renderEmpty() {
  const round = state?.lastRound
  $("empty-title").textContent = round ? "Ready for the next round." : "Start with what you see."
  $("empty-footnote").textContent = round
    ? `Last round: ${plural(round.count)} ${round.via === "clipboard" ? "copied" : `sent to ${round.to || "your session"}`} at ${new Date(round.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
    : "Send one note straight away, or collect a few first. Your feedback stays local until you send."
  $("restore-round").hidden = !round
}
function renderNotes() {
  const notes = state?.notes || []
  $("notes-section").hidden = !notes.length
  const pageCount = new Set(notes.map(note => note.page.url)).size
  $("count").textContent = `${plural(notes.length)} in this round${pageCount > 1 ? ` · ${pageCount} pages` : ""}`
  const key = JSON.stringify([notes, state?.page.url, state?.anchorStates, selectedNoteID])
  if (key === noteRenderKey) return
  noteRenderKey = key; $("notes").replaceChildren()
  let pageURL
  for (const [index, note] of notes.entries()) {
    if (note.page.url !== pageURL) {
      pageURL = note.page.url
      const page = note.page, url = new URL(page.url), header = make("li"), title = make("strong", page.title)
      header.className = "page-group"; header.title = page.url
      const heading = make("div"), clear = make("button", "Clear")
      heading.className = "page-group-heading"; clear.className = "text-button"
      clear.setAttribute("aria-label", `Clear notes from ${page.title}`)
      clear.onclick = () => run("clear", () => clearNotes(page.url))
      heading.append(title, clear)
      header.append(heading, make("span", `${url.host}${url.pathname}${page.url === state.page.url ? " · This page" : ""}`))
      $("notes").append(header)
    }
    const item = make("li"), number = make("span", index + 1), content = make("div"), target = make("button"), bottom = make("div"), meta = make("span")
    item.className = `note${selectedNoteID === note.id ? " is-current" : ""}`; item.dataset.noteId = note.id
    number.className = "note-number"; number.setAttribute("aria-label", `Note ${index + 1}`)
    target.className = "note-target"; target.setAttribute("aria-label", `Show note ${index + 1} on page`)
    target.append(make("span", note.anchor.quote.slice(0, 200)), icon("reveal"))
    target.onclick = () => run("reveal", async () => {
      await call({ action: "reveal", url: state.page.url, noteID: note.id }); selectedNoteID = note.id
      await refresh(); status("Element highlighted on the page"); renderNotes()
      $("notes").querySelector(`[data-note-id="${CSS.escape(note.id)}"] .note-target`)?.focus({ preventScroll: true })
    })
    const comment = make("p", note.comment); comment.className = "note-comment"
    content.append(target, comment)
    const anchorState = state.anchorStates[index]
    if (anchorState !== "located" && anchorState !== "elsewhere") { const warning = make("p", `Element ${anchorState}. Your feedback is kept.`); warning.className = "warning"; content.append(warning) }
    bottom.className = "note-bottom"; meta.className = "note-meta"
    if (note.kind === "ask") meta.append(make("span", "Question"))
    const edit = make("button", "Edit"), remove = make("button")
    edit.className = "text-button"; edit.setAttribute("aria-label", `Edit note ${index + 1}`)
    edit.onclick = () => run("edit", () => requestAction({ type: "edit", id: note.id }))
    remove.className = "icon-button"; remove.title = "Delete note"; remove.setAttribute("aria-label", `Delete note ${index + 1}`); remove.append(icon("trash"))
    remove.onclick = () => run("delete", () => model?.value?.editing?.id === note.id ? requestAction({ type: "delete", id: note.id }) : deleteNote(note.id))
    bottom.append(meta, edit, remove); content.append(bottom); item.append(number, content); $("notes").append(item)
  }
  $("preview").textContent = notes.length ? markdown(review()) : "Add a note to preview the feedback."
  call({ action: "markers" }).catch(() => {})
}
// Send always means session delivery; Copy instead is a separate, stable action.
function renderDelivery() {
  const retry = state?.outbox, pending = pendingCount(), count = retry?.count ?? pending
  const working = busy.has("send") || busy.has("copy-round")
  if (!deliverySupported) {
    $("empty-footnote").textContent = "Collect a few notes, then copy the round into your agent."
    $("paired").textContent = "Copy only"
    $("change-target").disabled = true
    $("link-state").textContent = ""
    $("link-state").className = "link-state"
    $("send-label").textContent = working && busy.has("copy-round") ? "Copying…" : count ? `Copy ${plural(count)}` : "Copy notes"
    $("send").disabled = locked() || outdated || !state || !count || !!model?.conflict
    $("send-arrow").toggleAttribute("hidden", !count || working)
    $("copy-round").hidden = true
    const currentNotice = notice && (!notice.page || notice.page === state?.page.url) ? notice : null
    for (const tone of ["error", "warning", "success"]) $("status").classList.toggle(tone, currentNotice?.tone === tone)
    $("status").textContent = currentNotice?.text || (connectionLoading ? "Preparing the panel…" :
      working ? "Copying to the clipboard…" :
      count ? "Safari keeps notes local. Copy the round and paste it into any agent." :
      "Safari keeps notes local. Add a note, then copy the round into your agent.")
    return
  }
  const wrongDestination = retry && retry.targetID !== destination?.id
  const choosing = !destination && targets.length > 0
  $("paired").textContent = destination?.title || (connectionLoading ? "Looking for your session…" : choosing ? "Choose a session" : "No session")
  $("change-target").title = destination ? `${destination.title}\n${destination.directory}` : "Choose where to send feedback"
  $("link-state").textContent = available ? "Live" : disconnected ? "Disconnected" : destination ? "Offline" : ""
  $("link-state").className = `link-state ${available ? "live" : "offline"}`
  $("send-label").textContent = working && !busy.has("copy-round") ? "Sending…" :
    !state ? "Open a page to start" : connectionLoading ? "Looking for your session…" :
    count ? `${retry ? "Retry" : "Send"} ${plural(count)}` : "Send notes"
  $("send").disabled = locked() || outdated || !state || connectionLoading || !count || (!retry && !!model?.conflict)
  $("send-arrow").toggleAttribute("hidden", !count || working)
  $("copy-round").hidden = !state || !count
  $("copy-round").disabled = locked() || outdated || !!model?.conflict
  const currentNotice = notice && (!notice.page || notice.page === state?.page.url) ? notice : null
  for (const tone of ["error", "warning", "success"]) $("status").classList.toggle(tone, currentNotice?.tone === tone)
  $("status").textContent = currentNotice?.text || (connectionLoading ? "Looking for your OpenCode session…" :
    working ? busy.has("copy-round") ? "Copying to the clipboard…" : "Sending to the session…" :
    disconnected ? "Disconnected · choose a session to reconnect, or copy instead." :
    wrongDestination ? "This batch belongs to the previous session." :
    choosing ? "Choose the session that should receive this review, or copy instead." :
    !available ? count ? `${destination ? "Session offline" : "No live session"} · Send will retry; Copy instead works with any agent.` :
      destination ? "Session offline · reopen it in OpenCode or AGY." : "No session · open one in OpenCode or AGY; notes can still be copied." :
    retry ? "Retry the previous batch. New feedback stays local." :
    count ? validDraft() ? "Sends to this session, including your current feedback." : "Sends to this session; the list starts fresh." : "Feedback stays local until you send.")
}
function render() {
  renderComposer(); renderNotes()
  $("undo-notice").hidden = !undoRecord
  $("undo-text").textContent = undoRecord ? `${plural(undoRecord.notes.length)} removed.` : ""
  controls()
}
function scheduleRefresh() { clearTimeout(scheduledRefresh); scheduledRefresh = setTimeout(() => refresh(), 30) }
async function refresh() {
  const request = ++refreshID
  try {
    const next = await call({ action: "current" })
    if (request !== refreshID) return
    if (next.protocol !== PROTOCOL) { markOutdated(); return }
    if (state?.page.url !== next.page.url) { pendingAction = null; selectedNoteID = null; pendingFocus = null; if (notice?.page) notice = null }
    state = next; model = modelFor(next)
    $("page-title").textContent = next.page.title; $("page-title").title = next.page.title
    const url = new URL(next.page.url)
    $("page-url").textContent = url.protocol === "file:" ? decodeURIComponent(url.pathname.split("/").pop()) : `${url.host}${url.pathname === "/" ? "" : url.pathname}`
    $("page-url").title = next.page.url
    const pageError = next.detached || next.error
    $("page-error").hidden = !pageError; $("page-error").textContent = pageError || ""
    $("pick-label").textContent = next.picking ? "Cancel pick (Esc)" : "Pick element"
    $("pick").setAttribute("aria-pressed", String(!!next.picking)); $("pick-hint").hidden = !!next.picking
    if (next.captureID && next.captureID !== model.captureID) {
      model.captureID = next.captureID
      if (next.anchor && next.draft.consumedCaptures?.[next.tabID] !== next.captureID) {
        notice = null
        if (anchorIdentity(next.anchor) !== anchorIdentity(model.value?.anchor)) await requestAction({ type: "select", anchor: next.anchor,
          capture: { id: next.captureID, tabID: next.tabID } })
        else model.value.captures = { ...model.value.captures, [next.tabID]: next.captureID }
      } else if (next.error) status(next.error, "error")
    }
    render()
  } catch (error) {
    if (request !== refreshID || error.code === "outdated") return
    state = null; $("page-error").hidden = false; $("page-error").textContent = error.message
    controls()
  }
}
function showSessionOptions(show = true, focus = true) {
  const opening = show && $("session-options").hidden
  $("session-options").hidden = !show; $("change-target").setAttribute("aria-expanded", String(show))
  if (opening) { $("session-filter").value = ""; showAllSessions = false; renderSessions() }
  if (show && focus) { notice = null; focusWhenReady("#session-filter", false) }
}
const RECENT_SESSIONS = 6
const recency = target => target.updated ?? target.registered ?? 0
const folder = directory => directory?.split("/").filter(Boolean).pop() || directory || ""
function ago(time) {
  if (!time) return ""
  const minutes = Math.floor((Date.now() - time) / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  const days = Math.floor(minutes / 1440)
  return days < 14 ? `${days}d ago` : new Date(time).toLocaleDateString()
}
function sortedSessions() {
  const created = target => target.created ?? recency(target)
  const order = sessionSort === "title" ? (a, b) => a.title.localeCompare(b.title) :
    sessionSort === "created" ? (a, b) => created(b) - created(a) : (a, b) => recency(b) - recency(a)
  return [...targets].sort((a, b) => order(a, b) || a.title.localeCompare(b.title))
}
function sessionRow(target, offline = false) {
  const button = make("button"); button.type = "button"; button.className = "session-row"; button.dataset.targetId = target.id
  button.setAttribute("aria-pressed", String(target.id === destination?.id)); button.title = `${target.title}\n${target.directory}`
  button.disabled = offline || locked() || outdated
  const time = offline ? "disconnected" : sessionSort === "created" ? target.created && `created ${ago(target.created)}` : ago(recency(target))
  const title = make("span", target.title), meta = make("span", [target.provider?.toUpperCase(), time, folder(target.directory)].filter(Boolean).join(" · "))
  title.className = "session-title"; meta.className = "session-meta"
  button.append(title, meta)
  return button
}
// Newest activity first; the rest stay reachable through the filter or "Show all".
function renderSessions() {
  const query = $("session-filter").value.trim().toLowerCase()
  const matches = sortedSessions().filter(target => !query || `${target.title} ${target.directory} ${target.provider}`.toLowerCase().includes(query))
  const limited = !query && !showAllSessions && matches.length > RECENT_SESSIONS
  const focused = document.activeElement?.closest?.("#targets [data-target-id]")?.dataset.targetId
  const rows = (limited ? matches.slice(0, RECENT_SESSIONS) : matches).map(target => sessionRow(target))
  if (destination && !query && !targets.some(target => target.id === destination.id)) rows.unshift(sessionRow(destination, true))
  if (!rows.length) { const empty = make("p", query ? "No matching sessions." : "No live sessions."); empty.className = "hint"; rows.push(empty) }
  $("targets").replaceChildren(...rows)
  if (focused) $("targets").querySelector(`[data-target-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true })
  const expandable = !query && matches.length > RECENT_SESSIONS
  $("show-all-sessions").hidden = !expandable
  $("show-all-sessions").textContent = showAllSessions ? "Show recent only" : `Show all ${matches.length}`
  $("workspaces").replaceChildren(...workspaces.filter(target => !query || target.directory.toLowerCase().includes(query)).map(target => {
    const button = make("button"); button.type = "button"; button.className = "session-row"; button.disabled = locked() || outdated
    button.title = `Create an empty session in ${target.directory} with the model selected in OpenCode`
    const title = make("span", `New session in ${folder(target.directory)}`), meta = make("span", target.directory)
    title.className = "session-title"; meta.className = "session-meta"; button.append(title, meta)
    button.onclick = () => createSession(target.id)
    return button
  }))
  $("workspaces").hidden = !$("workspaces").childElementCount
}
function refreshConnection() {
  if (connectionRefresh) return connectionRefreshRevision === connectionRevision
    ? connectionRefresh : connectionRefresh.then(() => refreshConnection())
  if (outdated) return Promise.resolve()
  clearTimeout(connectionTimer)
  connectionRefreshRevision = connectionRevision
  connectionRefresh = readConnection().finally(() => {
    connectionRefresh = undefined
    // Discover a session started after the panel promptly; a live connection needs
    // fewer probes. Schedule after completion so slow startup cannot pile up requests.
    if (!outdated) connectionTimer = setTimeout(() => {
      if (panelPolling()) refreshConnection()
    }, deliverySupported ? available ? 10000 : 1500 : 60000)
  })
  return connectionRefresh
}
async function readConnection() {
  const revision = connectionRevision
  try {
    const result = await call({ action: "connection" })
    if (revision !== connectionRevision) return
    deliverySupported = result.delivery !== false
    if (!deliverySupported) {
      targets = []; workspaces = []; available = null; destination = null; connectionError = ""
      disconnected = false
      $("connection-hint").textContent = "Safari keeps notes local. Copy a round and paste it into your agent."
      $("empty-footnote").textContent = "Collect a few notes, then copy the round into your agent."
      renderSessions()
      return
    }
    if (available?.id !== result.target?.id || destination?.id !== result.destination?.id) notice = null
    targets = result.targets; workspaces = result.workspaces; disconnected = result.disconnected
    available = result.target; destination = result.destination; connectionError = result.error || ""
    renderSessions()
    $("connection-hint").textContent = connectionError ? `Connection unavailable: ${connectionError}` : disconnected ? "Select a session to reconnect. Your notes and drafts are kept." : !available && destination ? "Reopen the original session in OpenCode or AGY. This list refreshes automatically." : workspaces.length && !targets.length ? "Create an empty session in an open workspace. Nothing is sent until you click Send." : targets.length > 1 && !destination ? "Choose the session that should receive this review." : !available ? "Open a session in OpenCode or AGY; this panel connects automatically." : ""
    if (!destination && (targets.length > 1 || workspaces.length)) showSessionOptions(true, false)
  } catch (error) {
    available = null; connectionError = error.message; $("connection-hint").textContent = `Session unavailable: ${error.message}`
  } finally { connectionLoading = false; controls() }
}
function review() { return validateReview({ version: 2, annotations: state.notes }) }

$("comment").addEventListener("input", () => {
  model.value.comment = $("comment").value; notice = null
  persistDraft(model).catch(() => {}); controls()
})
$("comment").addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !$("save").disabled) { event.preventDefault(); $("save").click() }
})
for (const button of $("kind").querySelectorAll("button")) {
  button.addEventListener("click", () => { model.value.kind = button.dataset.kind; persistDraft(model).catch(() => {}); renderComposer(); controls(); button.focus() })
  button.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return
    event.preventDefault(); $(model.value.kind === "comment" ? "kind-ask" : "kind-comment").click()
  })
}
$("save-shortcut").textContent = navigator.platform.includes("Mac") ? "⌘↵" : "Ctrl↵"
task("pick", async () => { notice = null; await call({ action: "pick" }); await refresh() })
task("save", async () => { await saveCurrent(); focusWhenReady("#pick") })
task("cancel", async () => { await discardDraft(); focusWhenReady("#pick") })
task("save-switch", async () => { const action = pendingAction; await saveCurrent(); await performAction(action) })
task("discard-switch", async () => { const action = pendingAction; await discardDraft(); await performAction(action) })
task("keep-editing", () => { pendingAction = null; renderComposer(); focusWhenReady("#comment") })
task("retry-draft", async () => { await persistDraft(model); status("Draft saved locally"); focusWhenReady("#comment") })
task("reload-draft", async () => {
  const conflict = model.conflict
  if (conflict.code === "draft-conflict") { model.record = conflict.draft; model.value = clone(conflict.draft.value); model.touched = false; model.error = null; model.conflict = null }
  else {
    const note = conflict.note
    model.error = null; model.conflict = null
    if (!note || note.deleted) await discardDraft()
    else openComposer({ anchor: note.anchor, kind: note.kind, comment: note.comment, editing: note })
  }
  pendingAction = null; notice = null; render(); focusWhenReady(model.value ? "#comment" : "#pick")
})
task("keep-draft", async () => {
  const conflict = model.conflict
  if (conflict.code === "draft-conflict") model.record = conflict.draft
  else model.value.editing = conflict.note?.deleted ? null : conflict.note
  model.error = null; model.conflict = null
  await persistDraft(model); status("Your draft is saved locally"); focusWhenReady("#comment")
})
task("copy-draft", async () => {
  try { await navigator.clipboard.writeText(model.value.comment); status("Draft copied") }
  catch { $("comment").focus(); $("comment").select(); status("Automatic copy was blocked. Press Cmd/Ctrl+C to copy your draft.", "error") }
})
task("undo", async () => {
  const { notes } = undoRecord
  await call({ action: "restore-notes", notes: notes.map(note => ({ url: note.page.url, id: note.id, revision: note.revision })) }); undoRecord = null
  await refresh(); status(`${plural(notes.length)} restored`); focusWhenReady(`[data-note-id="${CSS.escape(notes[0].id)}"] .note-target`)
})
task("clear", () => clearNotes())
$("confirm-clear").addEventListener("click", () => run("clear", () => clearNotes(undefined, clearBatchID)))
task("cancel-clear", () => { clearBatchID = null; $("clear-warning").hidden = true; focusWhenReady("#clear") })
task("more", () => { const show = $("utilities").hidden; $("utilities").hidden = !show; $("more").setAttribute("aria-expanded", String(show)); if (show) $("panel-body").scrollTop = 0 })
task("change-target", async () => { showSessionOptions($("session-options").hidden); if (!$("session-options").hidden) await refreshConnection() })
$("session-sort").value = sessionSort
$("session-sort").addEventListener("change", () => { sessionSort = $("session-sort").value; localStorage.setItem("sessionSort", sessionSort); renderSessions() })
$("session-filter").addEventListener("input", renderSessions)
$("session-filter").addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); $("targets").querySelector(".session-row:enabled")?.click() }
  if (event.key === "ArrowDown") { event.preventDefault(); $("targets").querySelector(".session-row:enabled")?.focus() }
})
$("targets").addEventListener("keydown", event => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return
  const rows = [...$("targets").querySelectorAll(".session-row:enabled")], index = rows.indexOf(document.activeElement)
  event.preventDefault()
  if (event.key === "ArrowUp" && index <= 0) $("session-filter").focus()
  else rows[Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))]?.focus()
})
$("show-all-sessions").addEventListener("click", () => { showAllSessions = !showAllSessions; renderSessions() })
$("targets").addEventListener("click", event => {
  const row = event.target.closest(".session-row")
  if (row && !row.disabled) choose(row.dataset.targetId)
})
const choose = targetID => run("targets", async () => {
  const target = targets.find(target => target.id === targetID)
  if (!target) return
  connectionRevision++
  destination = (await call({ action: "pair", target })).target; available = destination; connectionError = ""; notice = null
  disconnected = false
  showSessionOptions(false); renderDelivery(); renderSessions(); focusWhenReady("#change-target", false)
})
const createSession = targetID => run("new-session", async () => {
  connectionRevision++
  const result = await call({ action: "create-session", targetID })
  destination = available = result.target; disconnected = false; connectionError = ""
  targets = [...targets.filter(target => target.id !== destination.id), destination]
  showSessionOptions(false); renderSessions(); status("Empty session created. Your notes stay local until you send.", "success")
  focusWhenReady("#change-target", false)
})
$("new-session").addEventListener("click", () => { if (destination) createSession(destination.id) })
task("disconnect", async () => {
  connectionRevision++
  destination = (await call({ action: "disconnect", targetID: destination.id })).target
  available = null; disconnected = true
  showSessionOptions(false); renderSessions(); status("Disconnected. Your notes and drafts are kept.")
  focusWhenReady("#change-target", false)
})
function showManualCopy(text) {
  $("utilities").hidden = false; $("more").setAttribute("aria-expanded", "true"); $("context-details").open = true
  $("preview").textContent = text
  const range = document.createRange(); range.selectNodeContents($("preview")); getSelection().removeAllRanges(); getSelection().addRange(range)
  $("preview").scrollIntoView({ block: "nearest" })
}
// Chrome only grants clipboard access during the click, so copy before any storage round trip.
function copyText(text) {
  const legacy = () => {
    const area = make("textarea"); area.value = text; area.readOnly = true; area.style.cssText = "position:fixed;opacity:0;pointer-events:none"
    document.body.append(area); area.select()
    try { return document.execCommand("copy") } finally { area.remove() }
  }
  return navigator.clipboard.writeText(text).catch(error => { if (!legacy()) throw error })
}
async function copyRound() {
  if (model.error || model.conflict) throw model.conflict || model.error
  const prepared = validDraft() ? draftNote(clone(model.value)) : null
  const notes = !prepared ? state.notes : state.notes.some(note => note.id === prepared.id)
    ? state.notes.map(note => note.id === prepared.id ? prepared : note) : [...state.notes, prepared]
  const text = markdown(validateReview({ version: 2, annotations: notes }))
  try { await copyText(text) }
  catch {
    showManualCopy(text)
    status("Automatic copy was blocked. The preview is selected; press Cmd/Ctrl+C. Notes stay in this round.", "error")
    return
  }
  if (prepared) await saveCurrent(prepared)
  const result = await call({ action: "copied", notes: notes.map(({ id, revision, page }) => ({ id, revision, page })) })
  await refresh()
  status(`Copied ${plural(result.count)} · paste into any agent. Ready for the next round.`, "success", null)
  focusWhenReady(model.value ? "#comment" : "#pick")
}
task("copy-round", copyRound)
task("restore-round", async () => {
  const result = await call({ action: "restore-round", url: state.page.url, roundID: state.lastRound.id })
  await refresh(); status(`Restored ${plural(result.count)} to this round`, "", null); focusWhenReady("#notes .note-target")
})
task("send", async () => {
  // Safari has no reachable bridge; the primary button copies out instead.
  if (!deliverySupported) return copyRound()
  if (!available || !destination) {
    await refreshConnection()
    if (!destination && targets.length) { showSessionOptions(); status("Choose the session that should receive this review, or copy instead.", "warning"); return }
    if (!available) { showSessionOptions(); status("No live session. Notes are kept; reopen the session or use Copy instead.", "warning"); return }
  }
  if (state.outbox && state.outbox.targetID !== destination.id) { showSessionOptions(); status("Choose the original session to retry this batch, or copy your notes.", "warning"); return }
  const target = destination, page = state.page
  if (!state.outbox) {
    if (model.error || model.conflict) throw model.conflict || model.error
    if (validDraft()) await saveCurrent()
  }
  status("Sending feedback…", "", null)
  let result
  try { result = await call({ action: "send", url: page.url, targetID: target.id }) }
  catch (error) {
    await Promise.all([refresh(), refreshConnection()])
    if (available) throw error
    status("The session went offline before receiving this round. Notes are kept; reopen it or use Copy instead.", "warning", null)
    return
  }
  await refresh(); $("status").title = result.messageID
  status(`Sent ${plural(result.count)} to ${target.title}. Ready for the next round.`, "success", null)
  focusWhenReady(model.value ? "#comment" : "#pick")
})
$("reload-extension").addEventListener("click", () => chrome.runtime.reload())
task("copy", async () => {
  const text = markdown(review())
  try { await copyText(text); status("Context copied. Notes stay in this round.") }
  catch { showManualCopy(text); status("Automatic copy was blocked. The preview is selected; press Cmd/Ctrl+C.", "error") }
})
task("export", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(review(), null, 2)], { type: "application/json" }))
  const link = make("a"); link.href = url; link.download = "annotate-feedback.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  status("Complete review exported")
})
document.addEventListener("click", event => {
  if (!$("session-options").hidden && !$("session-options").contains(event.target) && !$("change-target").contains(event.target)) showSessionOptions(false)
})
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return
  if (state?.picking) $("pick").click()
  pendingAction = null; $("utilities").hidden = true; $("more").setAttribute("aria-expanded", "false"); showSessionOptions(false); renderComposer()
})
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" || area === "session") {
    const ownDraftsOnly = Object.entries(changes).every(([key, value]) => key.startsWith("draft:") && value.newValue?.writerID === writerID)
    if (!ownDraftsOnly) scheduleRefresh()
  }
   if (changes.paired || changes.disconnected) refreshConnection()
})
chrome.tabs.onActivated.addListener(scheduleRefresh)
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.status === "complete") scheduleRefresh() })
setInterval(() => { if (panelPolling()) refresh() }, 1500)
document.addEventListener("visibilitychange", () => { if (panelPolling()) refreshConnection() })
window.addEventListener("focus", refreshConnection)
await Promise.all([refreshConnection(), refresh()])
