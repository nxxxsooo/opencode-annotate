import assert from "node:assert/strict"
import { test } from "node:test"
import { readSession, referenceMarkdown, searchSessions } from "./session-reference.mjs"
import { registerSessionTools } from "./session-tools.mjs"
import { createReferenceCommand } from "./reference-command.mjs"
import { serverHistoryClient } from "./server-history.mjs"

const session = (id = "ses_source", projectID = "project") => ({
  id, projectID, title: "Previous design", location: { directory: "/source" },
  time: { created: 1, updated: 2 },
})
const user = (id, text) => ({ id, type: "user", text, time: { created: 1 } })
const assistant = (id, text, extra = {}) => ({
  id, type: "assistant", content: [{ type: "text", text }],
  time: { created: 2, completed: 3 }, finish: "stop", ...extra,
})
const pad = messages => [...messages, ...Array.from({ length: 50 - messages.length }, (_, index) => ({ type: "shell", id: `msg_shell${index}` }))]

function clientFor(pages, messages = []) {
  const requests = []
  return {
    requests,
    session: {
      get: async ({ sessionID }) => session(sessionID),
      message: { get: async ({ messageID }) => messages.find(message => message.id === messageID) },
    },
    message: { async list(input, options) {
      requests.push(input)
      assert.equal(options.headers["accept-encoding"], "identity")
      return pages[requests.length - 1]
    } },
  }
}

test("title search scopes to the caller's project, excludes itself, and preserves cursor filters", async () => {
  const calls = []
  const client = { session: { list: async input => {
    calls.push(input)
    return { data: [session("ses_current", "caller-project"), session("ses_source", "caller-project"), session("ses_foreign", "foreign")], cursor: { next: "page2" } }
  } } }
  const current = session("ses_current", "caller-project")
  const found = await searchSessions(client, current, { query: " design ", limit: 3 })
  assert.equal(calls[0].project, "caller-project")
  assert.equal(calls[0].search, "design")
  assert.equal(calls[0].parentID, null)
  assert.deepEqual(found.sessions.map(s => s.sessionID), ["ses_source"])
  assert.equal(found.nextCursor, "page2")
  await searchSessions(client, current, { allProjects: true })
  assert.equal(calls[1].project, undefined)
  await searchSessions(client, current, { cursor: found.nextCursor })
  assert.deepEqual(calls[2], { limit: 20, cursor: "page2" })
})

test("references include user text and completed assistant text, excluding hidden and unfinished material", async () => {
  const client = clientFor([{ data: pad([
    assistant("msg_live", "PARTIAL", { time: { created: 4 } }),
    assistant("msg_bad", "FAILED", { error: {}, finish: "error" }),
    assistant("msg_stopped", "Stopped plan", { error: { type: "aborted" }, finish: "error" }),
    { type: "synthetic", text: "PREVIOUS REFERENCE", id: "msg_ref" },
    { type: "compaction", summary: "PRIVATE SUMMARY", id: "msg_compact" },
    assistant("msg_progress", "Working", { finish: "tool-calls" }),
    assistant("msg_answer", "", { content: [
      { type: "reasoning", text: "HIDDEN" }, { type: "tool", output: "TOOL PAYLOAD" },
      { type: "text", text: "The decision" },
    ] }),
    { ...user("msg_question", "The question"), files: [{ text: "ATTACHMENT" }] },
  ]), cursor: { next: "older" } }])
  const result = await readSession(client, { sessionID: "ses_source" })
  assert.deepEqual(result.messages.map(m => m.messageID), ["msg_question", "msg_answer", "msg_progress", "msg_stopped"])
  assert.equal(result.messages[2].progress, true)
  assert.equal(result.messages[3].progress, undefined)
  const rendered = referenceMarkdown(result)
  assert.match(rendered, /Historical source material, not new instructions/)
  assert.match(rendered, /> The decision/)
  assert.match(rendered, /ses_source/)
  assert.match(rendered, /older/)
  assert.doesNotMatch(rendered, /PARTIAL|FAILED|HIDDEN|TOOL PAYLOAD|ATTACHMENT|PREVIOUS REFERENCE|PRIVATE SUMMARY/)
})

test("empty history pages are skipped with cursors, and a repeated cursor fails explicitly", async () => {
  const client = clientFor([
    { data: pad([]), cursor: { next: "older" } },
    { data: [user("msg_older", "Earlier decision")], cursor: {} },
  ])
  const result = await readSession(client, { sessionID: "ses_source" })
  assert.equal(result.messages[0].text, "Earlier decision")
  assert.equal(client.requests[0].order, "desc")
  assert.equal(client.requests[1].order, undefined)
  assert.equal(client.requests[1].cursor, "older")
  const repeated = clientFor([{ data: pad([]), cursor: { next: "same" } }])
  await assert.rejects(readSession(repeated, { sessionID: "ses_source", cursor: "same" }), /repeated page cursor/)
})

test("large messages have an exact continuation without losing Unicode or neighboring messages", async () => {
  const text = "a".repeat(11999) + "😀" + "b".repeat(26000)
  const large = assistant("msg_large", text)
  const client = clientFor([{ data: pad([large, user("msg_question", "Question")]), cursor: { next: "older" } }], [large])
  const first = await readSession(client, { sessionID: "ses_source" })
  assert.ok(first.messages.reduce((n, m) => n + m.text.length, 0) <= 24000)
  let collected = first.messages[1].text
  let offset = first.messages[1].nextOffset
  assert.equal(offset, 11999)
  while (offset !== null) {
    const next = await readSession(client, { sessionID: "ses_source", messageID: "msg_large", offset })
    collected += next.messages[0].text
    offset = next.messages[0].nextOffset
  }
  assert.equal(collected, text)
  assert.equal(first.nextCursor, "older")
  await assert.rejects(readSession(client, { sessionID: "ses_source", offset: 10 }), /requires a messageID/)
  await assert.rejects(readSession(client, { sessionID: "ses_source", messageID: "msg_large", offset: text.length }), /past the end/)
})

function commandHarness({ cancelPick = false, cancelComment = false, confirm = true, fail = false, comment = "", review, spoken = true, home = false } = {}) {
  let route = home ? { type: "home" } : { type: "session", sessionID: "ses_destination" }
  const sent = [], notices = [], selections = [], confirmations = [], presentations = [], prompts = [], created = [], navigations = [], locations = []
  const page = { data: [user("msg_question", "Old decision")], cursor: {} }
  const client = clientFor([page, page, page])
  const history = client.message.list
  client.message.list = async (input, options) => {
    if (input.type !== "user") return history(input, options)
    assert.equal(input.sessionID, "ses_destination")
    assert.equal(input.limit, 1)
    return { data: spoken ? [user("msg_spoken", "Hello")] : [], cursor: {} }
  }
  const projectID = home ? "home-project" : "project"
  client.session.list = async () => ({ data: [session("ses_source", projectID), session("ses_sameTitle", projectID)], cursor: {} })
  client.session.prompt = async input => {
    if (fail) throw new Error("Source server disconnected")
    assert.ok(!Object.hasOwn(input, "description"), "session.prompt must not receive a description field")
    sent.push(input)
  }
  client.session.synthetic = async () => { throw new Error("References must use session.prompt, not session.synthetic") }
  client.session.create = async input => {
    created.push(input)
    return { ...session("ses_destination", "home-project"), title: "New session", location: input.location }
  }
  client.location = { get: async input => {
    locations.push(input)
    return { directory: input.location.directory, project: { id: "home-project" } }
  } }
  const context = {
    client,
    location: { directory: "/home-dir" },
    ui: {
      model: { current: () => ({ providerID: "fixture", modelID: "model", variant: "high" }) },
      router: { current: () => route, navigate: next => { navigations.push(next); route = next } },
      toast: { show: input => notices.push(input) },
      dialog: {
        clear() {},
        set: input => presentations.push(input),
        select: async input => { selections.push(input); if (!home) route = { type: "session", sessionID: "ses_otherTab" }; return cancelPick ? undefined : "ses_source" },
        prompt: async input => { prompts.push(input); return cancelComment ? undefined : comment },
        confirm: async input => { confirmations.push(input); return confirm },
      },
    },
  }
  const command = createReferenceCommand(context, { review, promptComment: context.ui.dialog.prompt })
  return { context, command, sent, notices, selections, confirmations, presentations, prompts, created, navigations, locations }
}

test("/ref from OpenCode home searches its project and creates the session only on confirmation, without starting a turn", async () => {
  const cancelled = commandHarness({ home: true, confirm: false })
  await cancelled.command.run("design")
  assert.equal(cancelled.confirmations.length, 1)
  assert.deepEqual(cancelled.created, [], "cancelling leaves no empty session behind")
  assert.deepEqual(cancelled.sent, [])
  const h = commandHarness({ home: true, comment: "Background for my question." })
  const searches = []
  h.context.client.session.list = async input => {
    searches.push(input)
    return { data: [session("ses_source", "home-project"), session("ses_sameTitle", "home-project")], cursor: {} }
  }
  await h.command.run("design")
  assert.deepEqual(h.locations, [{ location: { directory: "/home-dir" } }])
  assert.equal(searches[0].project, "home-project")
  assert.equal(h.selections[0].options.length, 2)
  assert.equal(h.confirmations[0].label.confirm, "Attach")
  assert.match(h.confirmations[0].message, /To: New session\n\/home-dir/)
  assert.deepEqual(h.created, [{ location: { directory: "/home-dir" }, model: { providerID: "fixture", id: "model", variant: "high" } }])
  assert.deepEqual(h.navigations, [{ type: "session", sessionID: "ses_destination" }])
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0].sessionID, "ses_destination")
  assert.equal(h.sent[0].resume, false)
  assert.match(h.sent[0].text, /^# My reference comment\n\nBackground for my question\.[\s\S]*Old decision/)
  assert.match(h.notices.at(-1).message, /Write your message to start/)
  h.command.dispose()
})

test("/ref before the first message attaches without continuing, so references can be added repeatedly", async () => {
  const h = commandHarness({ spoken: false })
  await h.command.run("ses_source")
  await h.command.run("ses_source")
  assert.equal(h.sent.length, 2)
  assert.deepEqual(h.sent.map(input => [input.sessionID, input.resume, input.delivery]), [["ses_destination", false, "steer"], ["ses_destination", false, "steer"]])
  assert.deepEqual(h.created, [])
  assert.equal(h.confirmations[0].label.confirm, "Attach")
  h.command.dispose()
})

test("/ref --tui from home annotates first and creates the session only when delivering", async () => {
  const snapshots = []
  const review = { snapshot: async (...input) => snapshots.push(input) }
  const h = commandHarness({ home: true, review })
  await h.command.run("--tui ses_source")
  const [sessionID, , submission] = snapshots[0]
  assert.equal(sessionID, null)
  assert.equal(submission.title, "New session")
  assert.equal(submission.confirm({ count: 1, title: submission.title }).label.confirm, "Attach")
  assert.deepEqual(h.created, [])
  await submission.deliver({ id: "msg_annotated", text: "annotated" })
  assert.equal(h.created.length, 1)
  assert.equal(h.sent[0].sessionID, "ses_destination")
  assert.equal(h.sent[0].resume, false)
  h.command.dispose()
})

test("/ref disambiguates titles and continues only the captured session", async () => {
  const h = commandHarness()
  await h.command.run("design")
  assert.equal(h.selections[0].options.length, 2)
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0].sessionID, "ses_destination")
  assert.equal(h.sent[0].resume, true)
  assert.equal(h.sent[0].delivery, "steer")
  assert.equal(h.confirmations[0].label.confirm, "Attach and continue")
  assert.equal(h.sent[0].metadata.annotateReference.sessionID, "ses_source")
  const capturedMatch = h.sent[0].text.match(/Captured: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/)
  assert.ok(capturedMatch, "text must include captured timestamp")
  assert.equal(h.sent[0].metadata.annotateReference.capturedAt, capturedMatch[1], "metadata.capturedAt must match text timestamp")
  assert.match(h.sent[0].text, /Old decision/)
  h.command.dispose()
})

test("/ref continues with the whole-reference comment and historical context together", async () => {
  const h = commandHarness({ comment: "  Focus on the taxonomy decision.  " })
  await h.command.run("ses_source")
  assert.equal(h.prompts[0].title, "Comment on reference (optional)")
  assert.match(h.sent[0].text, /^# My reference comment\n\nFocus on the taxonomy decision\./)
  assert.match(h.sent[0].text, /# Referenced conversation/)
  assert.equal(h.sent[0].resume, true)
  assert.equal(h.sent[0].delivery, "steer")
  h.command.dispose()
})

test("/ref preserves multiline comments, blank lines and wrapped CJK text", async () => {
  const comment = "First line\n\n保留多行留言与中文换行。".repeat(20) + "\nLast line"
  const h = commandHarness({ comment })
  await h.command.run("ses_source")
  assert.ok(h.sent[0].text.startsWith(`# My reference comment\n\n${comment}\n`))
  assert.equal(h.confirmations.length, 1)
  h.command.dispose()
})

test("/ref can annotate the captured snapshot in the TUI and attach the combined result", async () => {
  const snapshots = []
  const review = { snapshot: async (...input) => snapshots.push(input) }
  const h = commandHarness({ comment: "Use this as background.", review })
  h.context.ui.dialog.select = async input => {
    h.selections.push(input)
    input.actions.find(action => action.bind === "ctrl+t").onTrigger("ses_source")
  }
  await h.command.run("design")
  assert.deepEqual(h.sent, [])
  assert.equal(snapshots.length, 1)
  const [sessionID, source, submission] = snapshots[0]
  assert.equal(sessionID, "ses_destination")
  assert.match(source.text, /Use this as background\./)
  assert.match(source.text, /Old decision/)
  const text = submission.text("# Annotations on referenced-conversation.md\n\n## Annotation 1\n> Clarify this")
  assert.match(text, /Old decision[\s\S]*# Annotations on referenced-conversation\.md/)
  assert.equal(submission.confirm({ count: 1, title: "Current" }).label.confirm, "Attach and continue")
  await submission.deliver({ id: "msg_annotated", text })
  assert.equal(h.sent[0].id, "msg_annotated", "TUI deliver must pass the exact message id")
  assert.match(h.sent[0].text, /^# My reference comment\n\nUse this as background\./, "combined source-comment-annotation text")
  assert.match(h.sent[0].text, /Old decision/, "TUI text includes source conversation")
  assert.match(h.sent[0].text, /# Annotations on referenced-conversation\.md/, "TUI text includes annotations")
  assert.match(h.sent[0].text, /> Clarify this/, "TUI text includes annotation content")
  assert.equal(h.sent[0].sessionID, "ses_destination")
  assert.equal(h.sent[0].delivery, "steer")
  assert.equal(h.sent[0].resume, true)
  assert.equal(submission.success(1), "Attached 1 reference annotation. Continuing the conversation.")
  await h.command.run("--all --tui ses_source")
  assert.equal(snapshots.length, 2, "--tui also works with an explicit session ID")
  h.command.dispose()
})

test("/ref picker uses native title and directory columns while confirmation keeps the full path", async () => {
  const h = commandHarness()
  const source = {
    ...session(),
    location: { directory: "/Users/mingjian/Documents/sync/GitHub/opencode-annotate" },
  }
  const windows = {
    ...session("ses_windows"), title: "标题",
    location: { directory: String.raw`C:\Users\mingjian\Documents\sync\GitHub\another` },
  }
  h.context.client.session.list = async () => ({ data: [source, windows], cursor: {} })
  h.context.client.session.get = async ({ sessionID }) => sessionID === source.id ? source : session(sessionID)
  await h.command.run("design")
  const options = h.selections[0].options
  assert.deepEqual(h.presentations, [{ size: "xlarge" }])
  assert.equal(options[0].title, "Previous design")
  assert.equal(options[0].footer, "sync/opencode-annotate")
  assert.equal(options[1].title, "标题")
  assert.equal(options[1].footer, String.raw`sync\GitHub\another`)
  assert.match(h.confirmations[0].message, /\/Users\/mingjian\/Documents\/sync\/GitHub\/opencode-annotate/)
  h.command.dispose()
})

test("/ref leaves dynamic width allocation to native title and footer columns", async () => {
  const h = commandHarness()
  h.context.client.session.list = async () => ({ data: [session()], cursor: {} })
  await h.command.run("design")
  assert.equal(h.selections[0].options[0].title, "Previous design")
  assert.equal(h.selections[0].options[0].footer, "/source")
  assert.equal(h.selections[0].options[0].description, undefined)
  h.command.dispose()
})

test("/ref cancellation, empty results, disposal and failed delivery never report a successful attachment", async () => {
  for (const options of [{ cancelPick: true }, { cancelComment: true }, { confirm: false }, { fail: true }, { empty: true }, { dispose: true }]) {
    const h = commandHarness(options)
    if (options.empty) h.context.client.session.list = async () => ({ data: [], cursor: {} })
    if (options.dispose) h.context.ui.dialog.confirm = async () => { h.command.dispose(); return true }
    await h.command.run("missing")
    assert.deepEqual(h.sent, [])
    assert.equal(h.notices.some(n => n.variant === "success"), false)
    h.command.dispose()
  }
})

test("/ref supports explicit IDs, cross-project title search and search pagination", async () => {
  const h = commandHarness()
  await h.command.run("ses_source")
  assert.equal(h.selections.length, 0)
  assert.equal(h.sent.length, 1)
  const requests = []
  h.context.client.session.list = async input => {
    requests.push(input)
    return requests.length === 1 ? { data: Array.from({ length: 20 }, (_, index) => session(`ses_search${index}`)), cursor: { next: "more" } } : { data: [session()], cursor: {} }
  }
  h.context.ui.dialog.select = async ({ options }) => options.find(option => option.value === "more")?.value ?? options[0].value
  await h.command.run("--all previous design")
  assert.equal(requests[0].project, undefined)
  assert.equal(requests[0].search, "previous design")
  assert.equal(requests[1].cursor, "more")
  assert.equal(h.sent.length, 2)
  h.command.dispose()
})

test("/ref scope action reruns the same query between project and all projects", async () => {
  const h = commandHarness(), requests = []
  h.context.client.session.list = async input => {
    requests.push(input)
    return { data: [session()], cursor: {} }
  }
  h.context.ui.dialog.clear = () => {}
  h.context.ui.dialog.select = async input => {
    h.selections.push(input)
    if (h.selections.length < 3) {
      input.actions[0].onTrigger()
      return undefined
    }
    return "ses_source"
  }
  await h.command.run("design")
  assert.deepEqual(requests.map(request => request.project), ["project", undefined, "project"])
  assert.deepEqual(requests.map(request => request.search), ["design", "design", "design"])
  assert.deepEqual(h.selections.map(selection => selection.actions[0].title), ["All projects", "This project", "All projects"])
  assert.match(h.selections[0].title, /This project/)
  assert.match(h.selections[1].title, /All projects/)
  assert.equal(h.sent.length, 1)
  h.command.dispose()
})

test("server tools use the invoking session's project and enforce permission rules before reading", async () => {
  const definitions = [], permissions = []
  const client = clientFor([{ data: [user("msg_question", "Text")], cursor: {} }])
  client.session.list = async input => {
    assert.equal(input.project, "project")
    return { data: [session()], cursor: {} }
  }
  const context = {
    ...client, location: { project: { id: "wrong-plugin-project" } },
    tool: { transform: async fn => fn({ namespace() {}, add: value => definitions.push(value) }) },
    permission: { assert: async input => permissions.push(input) },
  }
  await registerSessionTools(context, { historyClient: async () => client })
  assert.equal(definitions.length, 2)
  const tool = { sessionID: "ses_destination", messageID: "msg_call", id: "call", agent: "build", signal: new AbortController().signal }
  await definitions[0].execute({}, tool)
  assert.deepEqual(permissions[0].resources, ["project"])
  assert.equal(permissions[0].action, "annotate_session_search")
  const output = await definitions[1].execute({ sessionID: "ses_source" }, tool)
  assert.equal(JSON.parse(output.content).messages[0].text, "Text")
  assert.equal(permissions[1].action, "annotate_session_read")
  context.permission.assert = async () => { throw new Error("Denied") }
  await assert.rejects(definitions[1].execute({ sessionID: "ses_source" }, tool), /Denied/)
  assert.equal(client.requests.length, 1)
})

test("full-history transport checks the server identity before reading any transcript", async () => {
  const calls = []
  const run = async (binary, args) => {
    assert.equal(binary, "opencode")
    calls.push(args)
    return { stdout: JSON.stringify(args[2] === "/api/info" ? { pid: 100 } : { data: [], cursor: {} }) }
  }
  await assert.rejects(serverHistoryClient({}, undefined, { run, processID: 200 }), /different process/)
  assert.equal(calls.length, 1)
  const client = await serverHistoryClient({}, undefined, { run, processID: 100 })
  await client.message.list({ sessionID: "ses_source", cursor: "a+b/c=", limit: 50 })
  assert.match(calls.at(-1)[2], /cursor=a%2Bb%2Fc%3D/)
})
