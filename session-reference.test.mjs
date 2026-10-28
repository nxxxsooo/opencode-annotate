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
  assert.deepEqual(result.messages.map(m => m.messageID), ["msg_question", "msg_answer", "msg_progress"])
  assert.equal(result.messages.at(-1).progress, true)
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

function commandHarness({ cancelPick = false, confirm = true, fail = false } = {}) {
  let route = { type: "session", sessionID: "ses_destination" }
  const sent = [], notices = [], selections = [], confirmations = []
  const page = { data: [user("msg_question", "Old decision")], cursor: {} }
  const client = clientFor([page, page])
  client.session.list = async () => ({ data: [session(), session("ses_sameTitle")], cursor: {} })
  client.session.synthetic = async input => {
    if (fail) throw new Error("Source server disconnected")
    sent.push(input)
  }
  const context = {
    client,
    ui: {
      router: { current: () => route },
      toast: { show: input => notices.push(input) },
      dialog: {
        select: async input => { selections.push(input); route = { type: "session", sessionID: "ses_otherTab" }; return cancelPick ? undefined : "ses_source" },
        confirm: async input => { confirmations.push(input); return confirm },
      },
    },
  }
  const command = createReferenceCommand(context)
  return { context, command, sent, notices, selections, confirmations }
}

test("/ref disambiguates titles and attaches only to the captured session without a model turn", async () => {
  const h = commandHarness()
  await h.command.run("design")
  assert.equal(h.selections[0].options.length, 2)
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0].sessionID, "ses_destination")
  assert.equal(h.sent[0].resume, false)
  assert.equal(h.sent[0].delivery, "queue")
  assert.equal(h.sent[0].metadata.annotateReference.sessionID, "ses_source")
  assert.match(h.sent[0].text, /Old decision/)
  h.command.dispose()
})

test("/ref cancellation, empty results, disposal and failed delivery never report a successful attachment", async () => {
  for (const options of [{ cancelPick: true }, { confirm: false }, { fail: true }, { empty: true }, { dispose: true }]) {
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
