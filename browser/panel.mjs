import { markdown, validateReview } from "./protocol.mjs"
const $ = id => document.getElementById(id)
let state, anchor, editing, targets = [], paired, pageURL, capturedIdentity, lastPageError, connectionBusy = false
let refreshID = 0, connectionRevision = 0
const busy = new Set()
const make = (tag, text = "") => { const node = document.createElement(tag); node.textContent = text; return node }
function status(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error) }
async function call(data) {
  const result = await chrome.runtime.sendMessage(data)
  if (!result?.ok) throw new Error(result?.error || "Extension disconnected; reopen the panel")
  return result
}
function task(id, fn) {
  $(id).addEventListener("click", async () => {
    busy.add(id); $(id).disabled = true; controls()
    try { await fn() } catch (error) { status(error.message, true) } finally { busy.delete(id); $(id).disabled = false; controls() }
  })
}
function controls() {
  const saving = busy.has("save") || busy.has("send")
  $("comment").disabled = $("kind").disabled = saving
  $("save").disabled = !state || !anchor || !$("comment").value.trim()
  $("send").disabled = !paired || !state || (!state.notes.some(n => n.sentRevision !== n.revision) && $("save").disabled)
  if (saving) $("save").disabled = true
  $("copy").disabled = $("export").disabled = !state?.notes.length
  $("pick").disabled = !state
  $("cancel").hidden = !editing && !anchor
  for (const id of busy) $(id).disabled = true
}
function reset() { anchor = null; editing = null; $("comment").value = ""; $("kind").value = "comment"; $("quote").textContent = "Select text or an element to begin."; $("save").textContent = "Save note"; controls() }
function review() { return validateReview({ version: 1, page: state.page, annotations: state.notes }) }
function renderNotes() {
  $("count").textContent = `${state.notes.length} notes`
  $("notes").replaceChildren()
  for (const [index, note] of state.notes.entries()) {
    const li = make("li"), actions = make("div"); actions.className = "actions"
    const edit = make("button", "Edit"), remove = make("button", "Delete")
    edit.onclick = () => { editing = note; anchor = note.anchor; $("quote").textContent = anchor.quote; $("comment").value = note.comment; $("kind").value = note.kind; $("save").textContent = "Save changes"; controls(); $("comment").focus() }
    remove.onclick = async () => {
      try { await call({ action: "delete", url: state.page.url, note, baseRevision: note.revision }); if (editing?.id === note.id) reset(); await refresh() }
      catch (error) { status(error.message, true) }
    }
    actions.append(edit, remove)
    li.append(make("small", `${note.kind} · ${note.sentRevision === note.revision ? "sent" : "pending"} · ${state.anchorStates?.[index] || "unavailable"} · ${note.anchor.quote.slice(0, 100)}`), make("p", note.comment), actions)
    $("notes").append(li)
  }
  $("preview").textContent = state.notes.length ? markdown(review()) : "No saved notes"
  call({ action: "markers" }).catch(() => {})
  controls()
}
async function refresh() {
  const requestID = ++refreshID
  try {
    const next = await call({ action: "current" })
    if (requestID !== refreshID) return
    if (pageURL !== next.page.url) { pageURL = next.page.url; reset(); capturedIdentity = null; lastPageError = null }
    const changed = JSON.stringify(state?.notes) !== JSON.stringify(next.notes) || JSON.stringify(state?.anchorStates) !== JSON.stringify(next.anchorStates)
    state = next
    $("page-title").textContent = state.page.title
    $("page-url").textContent = state.page.url
    if (state.anchor && JSON.stringify(state.anchor) !== capturedIdentity && !editing) {
      capturedIdentity = JSON.stringify(state.anchor); anchor = state.anchor; $("quote").textContent = anchor.quote
      status("Selected. Write feedback, then Send & continue.")
    }
    if (state.error && state.error !== lastPageError) status(state.error, true)
    lastPageError = state.error
    $("pick").textContent = state.picking ? "Cancel pick (Esc)" : "Pick an element"
    $("pick").setAttribute("aria-pressed", String(!!state.picking))
    $("pick-hint").textContent = state.picking ? "Click one page element. Picking ends after the click, or press Esc to cancel." : "Or select text on the page, write feedback, then send. Use Save note to collect several notes first."
    if (changed) renderNotes()
    controls()
  } catch (error) { if (requestID === refreshID) { state = null; controls(); status(error.message, true) } }
}
$("comment").addEventListener("input", controls)
$("comment").addEventListener("keydown", event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !$("save").disabled) { event.preventDefault(); $("save").click() } })
task("pick", async () => { const result = await call({ action: "pick" }); await refresh(); status(result.picking ? "Click a page element; Esc cancels" : "Selection cancelled") })
task("cancel", reset)
async function saveCurrent() {
  status("Saving note…")
  const now = new Date().toISOString()
  const note = { id: editing?.id || crypto.randomUUID(), revision: (editing?.revision || 0) + 1,
    createdAt: editing?.createdAt || now, updatedAt: now, kind: $("kind").value, comment: $("comment").value.trim(), anchor }
  await call({ action: "save", url: state.page.url, note, baseRevision: editing?.revision || 0 })
  reset(); await refresh(); status("Saved locally")
}
task("save", saveCurrent)
function showConnection() {
  $("paired").textContent = paired ? paired.title : targets.length > 1 ? "Choose where to send feedback" : "No connected session"
  $("paired").title = paired ? `${paired.title}\n${paired.directory}` : ""
  $("connection-hint").textContent = paired ? "Sending continues this session. Comments stay private until you send." : "Run /annotate web in the target OpenCode session."
  controls()
}
async function refreshConnection() {
  if (connectionBusy) return
  connectionBusy = true
  const revision = connectionRevision
  try {
  const result = await call({ action: "connection" })
  if (revision !== connectionRevision) return
  targets = result.targets; paired = result.target
  $("targets").replaceChildren(make("option", "Select a session…")); $("targets").firstChild.value = ""
  for (const target of targets) { const option = make("option", `${target.title} — ${target.directory}`); option.value = target.id; $("targets").append(option) }
  if (paired) $("targets").value = paired.id
  if (!paired && targets.length) { $("session-options").hidden = false; $("change-target").setAttribute("aria-expanded", "true") }
  showConnection()
  if (result.stale) $("connection-hint").textContent = "Previous session disconnected. Choose a session explicitly to switch."
  } catch (error) {
    if (revision === connectionRevision) { paired = null; showConnection(); $("connection-hint").textContent = `Session unavailable: ${error.message}` }
  } finally { connectionBusy = false; controls() }
}
task("refresh-targets", refreshConnection)
task("change-target", async () => {
  const hidden = !$("session-options").hidden
  $("session-options").hidden = hidden; $("change-target").setAttribute("aria-expanded", String(!hidden))
  if (!hidden) await refreshConnection()
})
$("targets").addEventListener("change", async () => {
  const target = targets.find(target => target.id === $("targets").value)
  if (!target) return
  connectionRevision++
  try {
    paired = (await call({ action: "pair", target })).target
    $("session-options").hidden = true; $("change-target").setAttribute("aria-expanded", "false"); showConnection()
  } catch (error) { status(error.message, true) }
})
task("send", async () => {
  const destination = paired
  if (!destination) throw new Error("Choose an OpenCode session before sending")
  status("Sending feedback…")
  if (anchor && $("comment").value.trim()) await saveCurrent()
  const response = await call({ action: "send", url: state.page.url, targetID: destination.id })
  await refresh(); $("status").title = response.messageID
  status("Feedback queued. The agent will continue in the selected session.")
})
task("copy", async () => {
  const text = markdown(review())
  try { await navigator.clipboard.writeText(text); status("Context copied. Paste it into any agent.") }
  catch {
    $("preview").textContent = text; document.querySelector("details").open = true
    const range = document.createRange(); range.selectNodeContents($("preview")); getSelection().removeAllRanges(); getSelection().addRange(range)
    status("Automatic copy was blocked. The preview is selected; press Cmd/Ctrl+C.", true)
  }
})
task("export", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(review(), null, 2)], { type: "application/json" }))
  const a = make("a"); a.href = url; a.download = "annotate-feedback.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  status("Complete review exported")
})
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" || area === "session") refresh(); if (changes.paired) refreshConnection() })
chrome.tabs.onActivated.addListener(refresh)
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.status === "complete") refresh() })
setInterval(() => { if (document.visibilityState === "visible") refresh() }, 1500)
setInterval(() => { if (!paired && document.visibilityState === "visible") refreshConnection() }, 10000)
window.addEventListener("focus", refreshConnection)
await Promise.all([refreshConnection(), refresh()])
