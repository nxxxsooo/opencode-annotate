import { randomUUID } from "node:crypto"
import { readSession, referenceMarkdown, searchSessions } from "./session-reference.mjs"

export function createReferenceCommand(context) {
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
        description: `${session.directory} · ${new Date(session.updated).toLocaleString()} · ${session.sessionID}`,
      }))
      if (page.nextCursor) options.push({ title: "More conversations…", value: "more", description: "Load the next page" })
      if (!options.length) {
        notice(allProjects ? "No matching conversations." : "No matching conversations in this project. Use /ref --all to search across projects.")
        return
      }
      const chosen = await context.ui.dialog.select({ title: "Reference a conversation", options })
      signal.throwIfAborted()
      if (chosen !== "more") return page.sessions.find(session => session.sessionID === chosen)?.sessionID
      cursor = page.nextCursor
      if (seen.has(cursor)) throw new Error("Session search returned a repeated page cursor.")
      seen.add(cursor)
    } while (cursor)
  }

  async function run(input = "") {
    if (disposed) return
    if (active) return notice("A reference is already being selected.")
    // Capture before awaiting the search; a tab change must not redirect the attachment.
    const route = context.ui.router.current()
    if (route.type !== "session") return notice("Open a session first.")
    const sessionID = route.sessionID
    const controller = new AbortController()
    active = controller
    const { signal } = controller
    try {
      let query = input.trim()
      const allProjects = /^--all(?:\s|$)/.test(query)
      if (allProjects) query = query.replace(/^--all\s*/, "")
      const current = await context.client.session.get({ sessionID }, { signal })
      const sourceID = /^ses_\S+$/.test(query) ? query : await choose(current, query, allProjects, signal)
      signal.throwIfAborted()
      if (!sourceID) return
      if (sourceID === sessionID) return notice("Choose a different conversation to reference.")
      const reference = await readSession(context.client, { sessionID: sourceID }, signal)
      signal.throwIfAborted()
      if (!reference.messages.length) return notice("No completed user or assistant text in this history range. Use annotate.session_read to inspect older pages.")
      const shortened = reference.nextCursor || reference.messages.some(message => message.nextOffset !== null)
      const confirmed = await context.ui.dialog.confirm({
        title: "Attach conversation reference?",
        message: `From: ${reference.source.title}\n${reference.source.directory}\nTo: ${current.title ?? sessionID}\n${reference.messages.length} text messages${shortened ? " (excerpt; more history available)" : ""}. Available to the next prompt; this does not start a model turn.`,
        label: { confirm: "Attach reference", cancel: "Cancel" },
      })
      signal.throwIfAborted()
      if (confirmed !== true) return
      await context.client.session.synthetic({
        sessionID, id: `msg_${randomUUID().replaceAll("-", "")}`,
        text: referenceMarkdown(reference), description: `Reference: ${reference.source.title}`,
        metadata: { annotateReference: { sessionID: sourceID, capturedAt: reference.capturedAt } },
        delivery: "queue", resume: false,
      }, { signal })
      if (!disposed) notice(`Attached “${reference.source.title}” to “${current.title ?? sessionID}” for the next prompt.`, "success")
    } catch (error) {
      if (!disposed) notice(error instanceof Error ? error.message : String(error), "error")
    } finally {
      active = undefined
    }
  }

  return { run, dispose() { disposed = true; active?.abort() } }
}
