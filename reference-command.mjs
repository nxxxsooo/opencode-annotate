import { randomUUID } from "node:crypto"
import { readSession, referenceMarkdown, searchSessions } from "./session-reference.mjs"
import { feedbackInput } from "./delivery.mjs"
import { homeSession } from "./web-review.mjs"

const DIRECTORY_CAP = 28
const TOGGLE_SCOPE = Symbol("toggle-scope")
const wide = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u
const zeroWidth = /[\p{Mark}\u200D\uFE0F]/u
const characterWidth = character => zeroWidth.test(character) ? 0 : wide.test(character) ? 2 : 1
const textWidth = text => Array.from(text).reduce((width, character) => width + characterWidth(character), 0)

function truncateLeft(text, width) {
  if (textWidth(text) <= width) return text
  let result = "", used = 0
  for (const character of Array.from(text).reverse()) {
    const next = characterWidth(character)
    if (used + next > width - 1) break
    result = character + result
    used += next
  }
  return `…${result}`
}

// The native footer owns a right-aligned directory column, leaving the title
// all remaining cells instead of reserving a fixed percentage in plugin code.

function directoryTail(directory, depth = 3) {
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/"
  const parts = directory.split(/[\\/]/).filter(Boolean)
  if (parts.length <= depth && textWidth(directory) <= DIRECTORY_CAP) return directory
  const kept = parts.slice(-depth)
  while (kept.length > 1 && textWidth(kept.join(separator)) > DIRECTORY_CAP) {
    let widest = 0
    for (let index = 1; index < kept.length - 1; index++) {
      if (textWidth(kept[index]) > textWidth(kept[widest])) widest = index
    }
    kept.splice(widest, 1)
  }
  return truncateLeft(kept.join(separator), DIRECTORY_CAP)
}

export function createReferenceCommand(context, { review, promptComment }) {
  let active
  let disposed = false
  const notice = (message, variant = "info") => context.ui.toast.show({
    title: "Annotate reference", message, variant, duration: variant === "error" ? 15000 : 5000,
  })

  async function choose(current, query, allProjects, signal) {
    let cursor
    const seen = new Set()
    do {
      const page = await searchSessions(context.client, current, { query, allProjects, cursor }, signal)
      signal.throwIfAborted()
      const options = page.sessions.map(session => ({
        title: session.title, value: session.sessionID,
        footer: directoryTail(session.directory),
      }))
      if (page.nextCursor) options.push({ title: "More conversations…", value: "more", description: "Load the next page" })
      if (!options.length) {
        notice(allProjects ? "No matching conversations." : "No matching conversations in this project. Use /ref --all to search across projects.")
        return
      }
      let toggle = false
      let annotate
      const selection = context.ui.dialog.select({
        title: `Reference a conversation · ${allProjects ? "All projects" : "This project"}`,
        options,
        actions: [{
          bind: "ctrl+a", title: allProjects ? "This project" : "All projects", selection: "none",
          onTrigger: () => { toggle = true; context.ui.dialog.clear() },
        }, ...(review ? [{
          bind: "ctrl+t", title: "Annotate in TUI",
          onTrigger: value => {
            if (value === "more") return
            annotate = value
            context.ui.dialog.clear()
          },
        }] : [])],
      })
      context.ui.dialog.set({ size: "xlarge" })
      const chosen = await selection
      signal.throwIfAborted()
      if (toggle) return TOGGLE_SCOPE
      if (annotate) return { sessionID: annotate, tui: true }
      if (chosen !== "more") return page.sessions.find(session => session.sessionID === chosen)?.sessionID
      cursor = page.nextCursor
      if (seen.has(cursor)) throw new Error("Session search returned a repeated page cursor.")
      seen.add(cursor)
    } while (cursor)
  }

  const attach = (sessionID, id, text, reference, resume, signal) => context.client.session.prompt(feedbackInput({
    sessionID, id, resume,
    text,
    metadata: { annotateReference: { sessionID: reference.source.sessionID, capturedAt: reference.capturedAt } },
  }), { signal })

  // Before the first user message there is nothing to continue: references wait as
  // context for that message, so several can be attached first.
  async function destination(route, signal) {
    if (route.type === "home") {
      const initial = homeSession(context)
      const directory = initial.location?.directory
      if (!directory) throw new Error("Can't determine the working directory for a new session.")
      const location = await context.client.location.get({ location: { directory } }, { signal })
      return {
        current: { projectID: location.project.id }, title: "New session", directory, fresh: true,
        async open() {
          const session = await context.client.session.create({ location: initial.location, ...(initial.model ? { model: initial.model } : {}) }, { signal })
          if (context.ui.router.current().type === "home") context.ui.router.navigate({ type: "session", sessionID: session.id })
          return session.id
        },
      }
    }
    const sessionID = route.sessionID
    const [current, spoken] = await Promise.all([
      context.client.session.get({ sessionID }, { signal }),
      context.client.message.list({ sessionID, type: "user", limit: 1, order: "desc" }, { signal, headers: { "accept-encoding": "identity" } }),
    ])
    return { current, sessionID, title: current.title ?? sessionID, fresh: !spoken.data.length, open: async () => sessionID }
  }

  async function run(input = "") {
    if (disposed) return
    if (active) return notice("A reference is already being selected.")
    // Capture before awaiting the search; a tab change must not redirect the attachment.
    const route = context.ui.router.current()
    if (route.type !== "session" && route.type !== "home") return notice("Open a session first.")
    const sessionID = route.type === "session" ? route.sessionID : undefined
    const controller = new AbortController()
    active = controller
    const { signal } = controller
    try {
      let query = input.trim()
      let allProjects = false
      let tui = false
      let flags = true
      while (flags) {
        if (/^--all(?:\s|$)/.test(query)) {
          allProjects = true
          query = query.replace(/^--all\s*/, "")
        } else if (/^--tui(?:\s|$)/.test(query)) {
          tui = true
          query = query.replace(/^--tui\s*/, "")
        } else flags = false
      }
      const target = await destination(route, signal)
      const { current, fresh } = target
      let picked
      do {
        picked = /^ses_\S+$/.test(query) ? query : await choose(current, query, allProjects, signal)
        if (picked === TOGGLE_SCOPE) allProjects = !allProjects
      } while (picked === TOGGLE_SCOPE)
      signal.throwIfAborted()
      if (!picked) return
      const sourceID = typeof picked === "object" ? picked.sessionID : picked
      tui ||= typeof picked === "object" && picked.tui
      if (sourceID === sessionID) return notice("Choose a different conversation to reference.")
      const reference = await readSession(context.client, { sessionID: sourceID }, signal)
      signal.throwIfAborted()
      if (!reference.messages.length) return notice("No completed user or assistant text in this history range. Use annotate.session_read to inspect older pages.")
      const comment = await promptComment({
        title: "Comment on reference (optional)",
        placeholder: "How should the assistant use this conversation?",
      }, signal)
      signal.throwIfAborted()
      if (comment == null) return
      const outcome = fresh ? "Write your message to start the conversation." : "Continuing the conversation."
      const label = { confirm: fresh ? "Attach" : "Attach and continue", cancel: "Cancel" }
      const deliver = async (id, text) => attach(await target.open(), id, text, reference, !fresh, signal)
      if (tui) {
        if (!review) throw new Error("TUI annotation is unavailable.")
        return await review.snapshot(sessionID ?? null, {
          text: referenceMarkdown(reference, { comment }), snapshot: "referenced-conversation.md",
        }, {
          title: target.title,
          text: annotations => referenceMarkdown(reference, { comment, annotations }),
          confirm: ({ count, title }) => ({
            title: "Attach annotated reference?",
            message: `Attach ${count} ${count === 1 ? "annotation" : "annotations"} to "${title}"${fresh ? "? The assistant reads it with your first message." : " and let the assistant continue?"}`,
            label,
          }),
          deliver: ({ id, text }) => deliver(id, text),
          success: count => `Attached ${count} reference ${count === 1 ? "annotation" : "annotations"}. ${outcome}`,
        })
      }
      const shortened = reference.nextCursor || reference.messages.some(message => message.nextOffset !== null)
      const confirmed = await context.ui.dialog.confirm({
        title: "Attach conversation reference?",
        message: `From: ${reference.source.title}\n${reference.source.directory}\nTo: ${target.title}${target.directory ? `\n${target.directory}` : ""}\n${reference.messages.length} text messages${shortened ? " (excerpt; more history available)" : ""}. ${fresh ? "Attach this reference? The assistant reads it with your first message." : "Attach this reference and let the assistant continue?"}`,
        label,
      })
      signal.throwIfAborted()
      if (confirmed !== true) return
      await deliver(`msg_${randomUUID().replaceAll("-", "")}`, referenceMarkdown(reference, { comment }))
      if (!disposed) notice(`Attached “${reference.source.title}” to “${target.title}”. ${outcome}`, "success")
    } catch (error) {
      if (!disposed) notice(error instanceof Error ? error.message : String(error), "error")
    } finally {
      active = undefined
    }
  }

  return { run, dispose() { disposed = true; active?.abort() } }
}
