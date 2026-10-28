import { PROTOCOL, markdown, validateReview } from "./protocol.mjs"

const $ = id => document.getElementById(id)
const make = (tag, text = "") => { const node = document.createElement(tag); node.textContent = text; return node }
const clone = value => structuredClone(value)
const writerID = crypto.randomUUID(), models = new Map(), busy = new Set()
let state, model, destination, available, targets = [], connectionError = "", connectionLoading = true
let refreshID = 0, connectionRevision = 0, connectionBusy = false, scheduledRefresh
let pendingAction, pendingFocus, undoRecord, selectedNoteID, noteRenderKey, connectionOptionsKey, notice, outdated = false

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("class", "icon"); svg.setAttribute("aria-hidden", "true")
  const use = document.createElementNS(svg.namespaceURI, "use"); use.setAttribute("href", `#icon-${name}`)
  svg.append(use); return svg
}
async function call(data) {
  const result = await chrome.runtime.sendMessage(data)
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
    status(error.message, "error")
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
const anchorIdentity = anchor => anchor ? JSON.stringify([anchor.type, anchor.selector, anchor.quote, anchor.prefix, anchor.suffix]) : ""
function pendingCount() {
  const pending = state?.notes.filter(note => note.sentRevision !== note.revision) || []
  return pending.length + (validDraft() && !pending.some(note => note.id === model.value.editing?.id) ? 1 : 0)
}
function locked() { return ["save", "send", "copy-round", "restore-round", "cancel", "save-switch", "discard-switch", "delete", "undo", "reload-draft", "keep-draft"].some(id => busy.has(id)) }
function controls() {
  const lock = locked() || outdated
  $("comment").disabled = lock
  for (const button of $("kind").querySelectorAll("button")) button.disabled = lock
  $("save").disabled = lock || !state || !validDraft() || !!model?.conflict
  $("save-switch").disabled = lock || !validDraft() || !!model?.conflict
  $("pick").disabled = !state || lock
  $("cancel").disabled = lock
  for (const id of ["discard-switch", "keep-editing", "retry-draft", "reload-draft", "keep-draft", "copy-draft", "undo", "restore-round", "targets", "change-target", "refresh-targets"]) $(id).disabled = lock
  $("copy").disabled = $("export").disabled = !state?.notes.length
  for (const button of $("notes").querySelectorAll("button")) button.disabled = lock
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
    createdAt: value.editing?.createdAt || now, updatedAt: now, kind: value.kind, comment: value.comment.trim(), anchor: value.anchor }
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
  undoRecord = { note: result.note, url: state.page.url }
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
  $("count").textContent = `${plural(notes.length)} in this round`
  const key = JSON.stringify([notes, state?.anchorStates, selectedNoteID])
  if (key === noteRenderKey) return
  noteRenderKey = key; $("notes").replaceChildren()
  for (const [index, note] of notes.entries()) {
    const item = make("li"), number = make("span", index + 1), content = make("div"), target = make("button"), bottom = make("div"), meta = make("span")
    item.className = `note${selectedNoteID === note.id ? " is-current" : ""}`; item.dataset.noteId = note.id
    number.className = "note-number"; number.setAttribute("aria-label", `Note ${index + 1}`)
    target.className = "note-target"; target.setAttribute("aria-label", `Show note ${index + 1} on page`)
    target.append(make("span", note.anchor.quote.slice(0, 200)), icon("reveal"))
    target.onclick = () => run("reveal", async () => {
      await call({ action: "reveal", url: state.page.url, noteID: note.id }); selectedNoteID = note.id
      status("Element highlighted on the page"); renderNotes()
      $("notes").querySelector(`[data-note-id="${CSS.escape(note.id)}"] .note-target`)?.focus({ preventScroll: true })
    })
    const comment = make("p", note.comment); comment.className = "note-comment"
    content.append(target, comment)
    const anchorState = state.anchorStates[index]
    if (anchorState !== "located") { const warning = make("p", `Element ${anchorState}. Your feedback is kept.`); warning.className = "warning"; content.append(warning) }
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
// Delivery has exactly two modes: a live session receives Send; otherwise the round is copied for any agent.
function deliveryMode() { return connectionLoading ? "loading" : available ? "send" : "copy" }
function renderDelivery() {
  const mode = deliveryMode(), retry = mode === "send" ? state?.outbox : null, pending = pendingCount()
  const count = retry?.count ?? pending, working = busy.has("send") || busy.has("copy-round")
  const wrongDestination = retry && retry.targetID !== destination?.id
  const choosing = !destination && targets.length > 0
  $("paired").textContent = destination?.title || (connectionLoading ? "Looking for your session…" : choosing ? "Choose a session" : "No session")
  $("change-target").title = destination ? `${destination.title}\n${destination.directory}` : "Choose where to send feedback"
  $("link-state").textContent = mode === "send" ? "Live" : mode === "copy" && destination ? "Offline" : ""
  $("link-state").className = `link-state ${mode === "send" ? "live" : "offline"}`
  $("send-label").textContent = working ? busy.has("copy-round") || mode === "copy" ? "Copying…" : "Sending…" :
    !state ? "Open a page to start" : mode === "loading" ? "Looking for your session…" :
    mode === "copy" ? count ? `Copy ${plural(count)}` : destination ? "Reconnect session" : choosing ? "Choose a session" : "Connect a session" :
    wrongDestination ? "Choose original session" : count ? `${retry ? "Retry" : "Send"} ${plural(count)}` : "Send notes"
  $("send").disabled = locked() || outdated || !state || mode === "loading" ||
    (mode === "send" && (!count || (!retry && !!model?.conflict))) || (mode === "copy" && !!count && !!model?.conflict)
  $("send-arrow").toggleAttribute("hidden", mode !== "send" || !count || working)
  $("send-copy").toggleAttribute("hidden", mode !== "copy" || !count || working)
  $("copy-round").hidden = mode !== "send" || !state || !pending
  $("copy-round").disabled = locked() || outdated || !!model?.conflict
  const currentNotice = notice && (!notice.page || notice.page === state?.page.url) ? notice : null
  for (const tone of ["error", "warning", "success"]) $("status").classList.toggle(tone, currentNotice?.tone === tone)
  const where = destination ? "Session offline" : "No session"
  $("status").textContent = currentNotice?.text || (mode === "loading" ? "Looking for your OpenCode session…" :
    working ? busy.has("copy-round") || mode === "copy" ? "Copying to the clipboard…" : "Sending to the session…" :
    mode === "copy" && choosing ? count ? "Choose a session above to send, or copy for any agent." : "Choose the session that should receive this review." :
    mode === "copy" ? count ? `${where} · Copy works with any agent. Run /annotate-web in a session to send instead.` :
      destination ? "Session offline · run /annotate-web in it to reconnect." : "No session · run /annotate-web in OpenCode, or add notes and copy them." :
    wrongDestination ? "This batch belongs to the previous session." : retry ? "Retry the previous batch. New feedback stays local." :
    count ? validDraft() ? "Sends to this session, including your current feedback." : "Sends to this session; the list starts fresh." : "Feedback stays local until you send.")
}
function render() {
  renderComposer(); renderNotes()
  $("undo-notice").hidden = !undoRecord || undoRecord.url !== state?.page.url
  controls()
}
function scheduleRefresh() { clearTimeout(scheduledRefresh); scheduledRefresh = setTimeout(() => refresh(), 30) }
async function refresh() {
  const request = ++refreshID
  try {
    const next = await call({ action: "current" })
    if (request !== refreshID) return
    if (next.protocol !== PROTOCOL) { markOutdated(); return }
    if (state?.page.url !== next.page.url) { pendingAction = null; selectedNoteID = null; notice = null }
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
  $("session-options").hidden = !show; $("change-target").setAttribute("aria-expanded", String(show))
  if (show && focus) { notice = null; $("panel-body").scrollTop = 0; focusWhenReady("#targets", false) }
}
async function refreshConnection() {
  if (connectionBusy) return
  connectionBusy = true
  const revision = connectionRevision
  try {
    const result = await call({ action: "connection" })
    if (revision !== connectionRevision) return
    if (available?.id !== result.target?.id || destination?.id !== result.destination?.id) notice = null
    targets = result.targets; available = result.target; destination = result.destination; connectionError = result.error || ""
    const optionsKey = JSON.stringify([targets.map(target => [target.id, target.provider, target.title, target.directory]), destination?.id, !!available])
    if (optionsKey !== connectionOptionsKey) {
      connectionOptionsKey = optionsKey
      $("targets").replaceChildren(make("option", "Choose a session…")); $("targets").firstChild.value = ""
      if (destination && !targets.some(target => target.id === destination.id)) {
        const badge = destination.provider ? `[${destination.provider.toUpperCase()}] ` : ""
        const option = make("option", `${badge}${destination.title} — disconnected`); option.value = destination.id; option.disabled = true; $("targets").append(option)
      }
      for (const target of targets) {
        const badge = target.provider ? `[${target.provider.toUpperCase()}] ` : ""
        const option = make("option", `${badge}${target.title} — ${target.directory}`); option.value = target.id; $("targets").append(option)
      }
      $("targets").value = destination?.id || ""
    }
    $("connection-hint").textContent = connectionError ? `Session unavailable: ${connectionError}` : !available && destination ? "Reconnect the original session, then refresh. Choose another session only to change the destination." : targets.length > 1 && !destination ? "Choose the session that should receive this review." : !available ? "Run /annotate-web in OpenCode or AGY, then refresh." : "Sending continues the selected session."
    if (!destination && targets.length > 1) showSessionOptions(true, false)
  } catch (error) {
    available = null; connectionError = error.message; $("connection-hint").textContent = `Session unavailable: ${error.message}`
  } finally { connectionBusy = false; connectionLoading = false; controls() }
}
function review() { return validateReview({ version: 1, page: state.page, annotations: state.notes }) }

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
  const { note, url } = undoRecord
  await call({ action: "restore", url, note, baseRevision: note.revision }); undoRecord = null
  await refresh(); status("Note restored"); focusWhenReady(`[data-note-id="${CSS.escape(note.id)}"] .note-target`)
})
task("more", () => { const show = $("utilities").hidden; $("utilities").hidden = !show; $("more").setAttribute("aria-expanded", String(show)); if (show) $("panel-body").scrollTop = 0 })
task("refresh-targets", refreshConnection)
task("change-target", async () => { showSessionOptions($("session-options").hidden); if (!$("session-options").hidden) await refreshConnection() })
$("targets").addEventListener("change", () => run("targets", async () => {
  const target = targets.find(target => target.id === $("targets").value)
  if (!target) return
  connectionRevision++
  destination = (await call({ action: "pair", target })).target; available = destination; connectionError = ""; notice = null
  showSessionOptions(false); renderDelivery(); focusWhenReady("#change-target", false)
}))
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
  const page = state.page
  if (model.error || model.conflict) throw model.conflict || model.error
  const prepared = validDraft() ? draftNote(clone(model.value)) : null
  const notes = !prepared ? state.notes : state.notes.some(note => note.id === prepared.id)
    ? state.notes.map(note => note.id === prepared.id ? prepared : note) : [...state.notes, prepared]
  const text = markdown(validateReview({ version: 1, page, annotations: notes }))
  try { await copyText(text) }
  catch {
    showManualCopy(text)
    status("Automatic copy was blocked. The preview is selected; press Cmd/Ctrl+C. Notes stay in this round.", "error")
    return
  }
  if (prepared) await saveCurrent(prepared)
  const result = await call({ action: "copied", url: page.url, notes: notes.map(({ id, revision }) => ({ id, revision })) })
  await refresh()
  status(`Copied ${plural(result.count)} · paste into any agent. Ready for the next round.`, "success", page.url)
  focusWhenReady(model.value ? "#comment" : "#pick")
}
task("copy-round", copyRound)
task("restore-round", async () => {
  const result = await call({ action: "restore-round", url: state.page.url, roundID: state.lastRound.id })
  await refresh(); status(`Restored ${plural(result.count)} to this round`); focusWhenReady("#notes .note-target")
})
task("send", async () => {
  // The click follows the visible label: Copy without a live session, Send with one.
  if (deliveryMode() === "copy") {
    if (state && pendingCount()) return copyRound()
    showSessionOptions(); await refreshConnection(); return
  }
  if (state.outbox && state.outbox.targetID !== destination.id) { showSessionOptions(); status("Choose the original session to retry this batch, or copy your notes.", "warning"); return }
  const target = destination, page = state.page
  if (!state.outbox) {
    if (model.error || model.conflict) throw model.conflict || model.error
    if (validDraft()) await saveCurrent()
  }
  status("Sending feedback…")
  let result
  try { result = await call({ action: "send", url: page.url, targetID: target.id }) }
  catch (error) {
    await Promise.all([refresh(), refreshConnection()])
    if (available) throw error
    status("The session went offline before receiving this round. Notes are kept; copy them, or run /annotate-web there and send again.", "warning", page.url)
    return
  }
  await refresh(); $("status").title = result.messageID
  status(`Sent ${plural(result.count)} to ${target.title}. Ready for the next round.`, "success", page.url)
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
  if (changes.paired) refreshConnection()
})
chrome.tabs.onActivated.addListener(scheduleRefresh)
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.status === "complete") scheduleRefresh() })
setInterval(() => { if (document.visibilityState === "visible") refresh() }, 1500)
setInterval(() => { if (document.visibilityState === "visible") refreshConnection() }, 10000)
window.addEventListener("focus", refreshConnection)
await Promise.all([refreshConnection(), refresh()])
