import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { listTargets } from "./bridge/receiver.mjs"
import { request } from "./bridge/wire.mjs"

const moduleURL = new URL("./review.mjs", import.meta.url)
const load = () => import(moduleURL)

function reply(id, text, extra = {}) {
  return {
    id, type: "assistant", time: { created: 100, completed: 101 },
    agent: "build", model: { providerID: "fixture", id: "fixture" },
    finish: "stop", content: [{ type: "text", text }], ...extra,
  }
}

test("latest reply excludes streaming text, tool commentary, errors, and reasoning", async () => {
  const { selectReply } = await load()
  const messages = [
    reply("msg_old", "Older", { time: { created: 1, completed: 2 } }),
    reply("msg_final", "First", { content: [
      { type: "reasoning", text: "Private reasoning" },
      { type: "text", text: "First" }, { type: "text", text: "第二段" },
    ] }),
    reply("msg_tools", "Working…", { time: { created: 200, completed: 201 }, finish: "tool-calls" }),
    reply("msg_error", "Broken", { time: { created: 300, completed: 301 }, finish: "error", error: {} }),
    reply("msg_live", "Not finished", { time: { created: 400 } }),
  ]
  assert.deepEqual(selectReply(messages), { id: "msg_final", text: "First\n\n第二段" })
  assert.equal(selectReply([messages.at(-1)]), undefined)
})

function context({ confirm = true, sendError, changeRoute, paginated, sessionDir, status = "idle", message, route: initialRoute } = {}) {
  let route = initialRoute ?? { type: "session", sessionID: "ses_original" }
  const sent = [], transitions = [], notices = [], created = [], navigations = []
  let confirmationCount = 0
  let pages = 0
  let gets = 0
  const ctx = {
    options: {}, themeMode: "dark", location: { directory: "/wrong-client-directory" },
    renderer: {
      listeners: new Map(),
      on(name, listener) { this.listeners.set(name, listener) },
      off(name, listener) { if (this.listeners.get(name) === listener) this.listeners.delete(name) },
      select(text) { this.listeners.get("selection")?.({ getSelectedText: () => text }) },
      async suspend() { await null; transitions.push("suspend") },
      async resume() { await null; transitions.push("resume") },
      requestRender() { transitions.push("render") },
    },
    data: { location: { default: () => ({ directory: sessionDir }) }, session: {
      get: () => ({ title: "Original session" }),
      status: id => (assert.equal(id, "ses_original"), status),
      message: {
        async sync(id) {
          assert.equal(id, "ses_original")
          if (changeRoute) route = { type: "session", sessionID: "ses_other" }
        },
        list(id) {
          assert.equal(id, "ses_original")
          return [reply("msg_final", "# Review fixture\n\nAlpha paragraph.\n")]
        },
      },
    } },
    client: { message: { async list(input, options) {
      assert.equal(input.sessionID, "ses_original")
      assert.equal(input.type, "assistant")
      // Compressed history pages are slow enough to stall /annotate.
      assert.equal(options.headers["accept-encoding"], "identity")
      if (changeRoute) route = { type: "session", sessionID: "ses_other" }
      pages++
      if (paginated && pages === 1) {
        assert.equal(input.order, "desc")
        return { data: [reply("msg_tools", "Working", { finish: "tool-calls" })], cursor: { next: "older-page" } }
      }
      if (paginated) {
        assert.equal(input.cursor, "older-page")
        assert.equal(input.order, undefined)
      }
      return { data: [reply("msg_final", "# Review fixture\n\nAlpha paragraph.\n")], cursor: {} }
    } }, session: {
      async create(input) {
        created.push(input)
        sessionDir = input.location.directory
        return { id: "ses_original", title: "New session", location: input.location }
      },
      message: { async get(input, options) {
        assert.equal(input.sessionID, "ses_original")
        assert.equal(input.messageID, "msg_exact")
        assert.equal(options.headers["accept-encoding"], "identity")
        gets++
        if (changeRoute) route = { type: "session", sessionID: "ses_other" }
        return message ?? reply("msg_exact", "# Review fixture\n\nAlpha paragraph.\n")
      } },
      async get(input) {
        assert.equal(input.sessionID, "ses_original")
        if (changeRoute) route = { type: "session", sessionID: "ses_other" }
        return { id: "ses_original", title: "Original session", location: { directory: sessionDir } }
      },
      async prompt(input) {
      if (sendError) throw new Error("Delivery failed")
      sent.push(input)
      return { id: input.id, sessionID: input.sessionID, type: "user" }
    } } },
    ui: {
      router: { current: () => route, navigate(next) { navigations.push(next); route = next } },
      model: { current: () => ({ providerID: "fixture", modelID: "fixture", variant: "high" }) },
      toast: { show: notice => notices.push(notice) },
      dialog: {
        clear() {},
        async confirm() {
          confirmationCount++
          assert.deepEqual(transitions, ["suspend", "resume", "render"])
          return confirm
        },
      },
    },
  }
  return {
    ctx, sent, transitions, notices, created, navigations,
    confirmations: () => confirmationCount, pages: () => pages, gets: () => gets,
    setStatus: value => { status = value },
    setRoute: value => { route = value },
  }
}

async function harness(t, options = {}) {
  const { createReviewCommand } = await load()
  const root = await mkdtemp(path.join(os.tmpdir(), "annotate-last-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const state = context(options)
  let invocation
  // Never touch the real input source; record what the review asks for.
  const switches = []
  const inputSource = {
    command: "/fake/SlashSaver",
    ascii: async () => (switches.push("ascii"), "com.example.pinyin"),
    select: async id => { switches.push(`select ${id}`) },
  }
  const command = createReviewCommand(state.ctx, {
    tempRoot: root,
    inputSource,
    web: options.web,
    interactive: async input => {
      invocation = input
      assert.deepEqual(state.transitions, ["suspend"])
      assert.deepEqual(switches, ["ascii"], "the review browses in ASCII")
      assert.equal(await readFile(input.file, "utf8"), options.expectedText ?? "# Review fixture\n\nAlpha paragraph.\n")
      if (options.failTerminal) throw new Error("Terminal child failed")
      if (!options.empty) {
        // Exercise the bundled binary's real JSON store and export contract.
        execFileSync(input.binary, ["--annotate", input.file, "Alpha paragraph.", "请补充具体例子。", "comment"], {
          env: input.env, cwd: input.cwd,
        })
        if (options.archived) {
          const data = input.env.PLANNOTATOR_DATA_DIR
          const name = (await readdir(data, { recursive: true })).find(name => name.endsWith("annotations.json"))
          const file = path.join(data, name)
          const record = JSON.parse(await readFile(file, "utf8"))
          // Upstream 0.9.4's E → F moves whole records from annotations to archived.
          record.archived = record.annotations
          record.annotations = []
          await writeFile(file, JSON.stringify(record))
        }
      }
      // What the reviewer's S / Ctrl+S writes before quitting.
      if (options.sendIntent) await writeFile(input.env.PLANNOTATOR_TUI_SEND_INTENT, "send\n")
    },
  })
  t.after(command.dispose)
  return { ...state, command, root, switches, invocation: () => invocation }
}

test("the review browses in ASCII, hands the text source to the TUI and restores it", async t => {
  const h = await harness(t, { failTerminal: true })
  await h.command.run()
  assert.equal(h.invocation().env.PLANNOTATOR_TUI_INPUT_SOURCE, "/fake/SlashSaver")
  assert.equal(h.invocation().env.PLANNOTATOR_TUI_TEXT_INPUT_SOURCE, "com.example.pinyin")
  assert.deepEqual(h.switches, ["ascii", "select com.example.pinyin"], "restored even after a crash")
})

test("real TUI annotations go only to the captured session even after tab changes", async t => {
  const h = await harness(t, { changeRoute: true })
  await h.command.run()
  assert.equal(h.sent.length, 1)
  const sent = h.sent[0]
  assert.equal(sent.sessionID, "ses_original")
  assert.match(sent.id, /^msg_/)
  assert.match(sent.text, /msg_final/)
  assert.match(sent.text, /Alpha paragraph\./)
  assert.match(sent.text, /请补充具体例子。/)
  assert.equal(sent.delivery, "steer")
  assert.equal(sent.resume, true)
  assert.equal(h.confirmations(), 1)
  assert.deepEqual(await readdir(h.root), [])
})

test("annotations sent to a busy session wait in the queue", async t => {
  const h = await harness(t, { status: "running" })
  await h.command.run()
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0].delivery, "queue")
  assert.equal(h.sent[0].resume, true)
})

test("automatic review opens the exact completed reply and preserves confirmed delivery", async t => {
  const h = await harness(t, { sendIntent: true })
  await h.command.auto("ses_original", "msg_exact", 10)
  assert.equal(h.gets(), 1)
  assert.equal(h.pages(), 0, "must not substitute the latest historical reply")
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0].sessionID, "ses_original")
  assert.match(h.sent[0].text, /your reply msg_exact\./)
  assert.equal(h.sent[0].delivery, "steer")
  assert.deepEqual(h.transitions, ["suspend", "resume", "render"])
})

test("auto-review threshold is strictly greater and counts Unicode characters, not bytes", async t => {
  for (const [text, threshold, opens] of [
    ["中文🙂", 4, false], ["中文🙂", 3, false], ["中文🙂", 2, true],
    [" \n中文🙂\n ", 3, false], ["", 0, false], ["x", 0, true],
  ]) {
    const h = await harness(t, { message: reply("msg_exact", text), expectedText: text, empty: true })
    await h.command.auto("ses_original", "msg_exact", threshold)
    assert.equal(Boolean(h.invocation()), opens, JSON.stringify({ text, threshold }))
    assert.deepEqual(h.sent, [], "opening or dismissing an automatic review submits nothing")
  }
})

test("auto-review rejects unfinished, progress, failed and reasoning-only messages", async t => {
  for (const extra of [
    { time: { created: 1 } }, { finish: "tool-calls" }, { finish: "error" },
    { finish: "content-filter" }, { error: {} },
    { content: [{ type: "reasoning", text: "private reasoning" }] },
  ]) {
    const h = await harness(t, { message: reply("msg_exact", "long text", extra) })
    await h.command.auto("ses_original", "msg_exact", 0)
    assert.deepEqual(h.transitions, [])
    assert.deepEqual(h.sent, [])
  }
})

test("auto-review skips background sessions, a busy turn, and a tab change during loading", async t => {
  for (const options of [{ target: "ses_background" }, { status: "running" }, { changeRoute: true }]) {
    const h = await harness(t, options)
    await h.command.auto(options.target ?? "ses_original", "msg_exact", 0)
    assert.equal(h.gets(), options.changeRoute ? 1 : 0)
    assert.deepEqual(h.transitions, [])
    assert.deepEqual(h.notices, [], "automatic skips should be quiet")
  }
})

test("automatic loading is cancelled when another turn starts or the plugin is disposed", async t => {
  for (const dispose of [false, true]) {
    const h = await harness(t)
    let entered, release
    const loading = new Promise(resolve => { entered = resolve })
    const loaded = new Promise(resolve => { release = resolve })
    h.ctx.client.session.message.get = async () => {
      entered()
      await loaded
      return reply("msg_exact", "long text")
    }
    const automatic = h.command.auto("ses_original", "msg_exact", 0)
    await loading
    if (dispose) await h.command.dispose()
    else h.setStatus("running")
    release()
    await automatic
    assert.deepEqual(h.transitions, [])
    assert.deepEqual(h.sent, [])
    assert.deepEqual(await readdir(h.root), [])
  }
})

test("an automatic trigger never overlaps an existing review", async t => {
  const h = await harness(t, { empty: true })
  let release
  const loaded = new Promise(resolve => { release = resolve })
  const list = h.ctx.client.message.list
  h.ctx.client.message.list = async (...args) => { await loaded; return list(...args) }
  const manual = h.command.run()
  await h.command.auto("ses_original", "msg_exact", 0)
  assert.equal(h.gets(), 0)
  release()
  await manual
  assert.deepEqual(h.transitions, ["suspend", "resume", "render"])
  assert.deepEqual(h.notices.map(n => n.message), ["No annotations. Returned to the session."])
})

test("sending from the TUI delivers without a second confirmation", async t => {
  const h = await harness(t, { sendIntent: true, confirm: false })
  await h.command.run()
  assert.equal(h.sent.length, 1)
  assert.match(h.sent[0].text, /请补充具体例子。/)
  assert.equal(h.confirmations(), 0)
  assert.deepEqual(await readdir(h.root), [])
})

for (const [name, options] of [
  ["an empty review", { empty: true }],
  ["a cancelled confirmation", { confirm: false }],
]) {
  test(`${name} restores the terminal without submitting feedback`, async t => {
    const h = await harness(t, options)
    await h.command.run()
    assert.deepEqual(h.sent, [])
    assert.deepEqual(h.transitions, ["suspend", "resume", "render"])
    assert.equal(h.confirmations(), options.empty ? 0 : 1)
    assert.deepEqual(await readdir(h.root), [])
  })
}

test("a crashed child still restores OpenCode and submits nothing", async t => {
  const h = await harness(t, { failTerminal: true })
  await h.command.run()
  assert.deepEqual(h.sent, [])
  assert.deepEqual(h.transitions, ["suspend", "resume", "render"])
  assert.ok(h.notices.some(n => n.variant === "error"))
})

test("failed delivery preserves feedback and source with the original session identity", async t => {
  const h = await harness(t, { sendError: true })
  await h.command.run()
  const retained = await readdir(h.root)
  assert.equal(retained.length, 1)
  const feedback = await readFile(path.join(h.root, retained[0], "feedback.md"), "utf8")
  assert.match(feedback, /请补充具体例子。/)
  const metadata = JSON.parse(await readFile(path.join(h.root, retained[0], "review.json"), "utf8"))
  assert.equal(metadata.sessionID, "ses_original")
  assert.equal(metadata.messageID, "msg_final")
  assert.ok(h.notices.some(n => n.variant === "error" && n.message.includes("feedback.md")))
})

test("last completed reply is found beyond the newest page of tool messages", async t => {
  const h = await harness(t, { paginated: true })
  await h.command.run()
  assert.equal(h.pages(), 2)
  assert.equal(h.sent.length, 1)
  assert.match(h.sent[0].text, /msg_final/)
})

test("archived-only notes are preserved when the reviewer exports No annotations", async t => {
  const h = await harness(t, { archived: true })
  await h.command.run()
  assert.deepEqual(h.sent, [])
  const dirs = await readdir(h.root)
  assert.equal(dirs.length, 1)
  const data = path.join(h.root, dirs[0], "data")
  const name = (await readdir(data, { recursive: true })).find(name => name.endsWith("annotations.json"))
  const record = JSON.parse(await readFile(path.join(data, name), "utf8"))
  assert.equal(record.archived[0].body, "请补充具体例子。")
  assert.ok(h.notices.some(n => n.message.includes("archived") && n.message.includes(h.root)))
})

async function documentFolder(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "annotate-document-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

const progress = "# Progress\n\nFlash timing **first**. Alpha paragraph.\n"
function history(h) {
  h.ctx.client.message.list = async input => {
    assert.equal(input.sessionID, "ses_original")
    return { data: [
      reply("msg_final", "# Review fixture\n\nAlpha paragraph.\n", { time: { created: 300, completed: 301 } }),
      reply("msg_progress", progress, { time: { created: 200, completed: 201 }, finish: "tool-calls" }),
      reply("msg_live", "Not finished", { time: { created: 400 } }),
    ], cursor: {} }
  }
}

test("numbered replies are retired in favor of the picker", async t => {
  const h = await harness(t)
  await h.command.run("2")
  assert.deepEqual(h.transitions, [])
  assert.equal(h.pages(), 0)
  assert.ok(h.notices.some(n => n.variant === "error" && /annotate-pick/.test(n.message)))
})

test("webpages route to /annotate-web instead of /annotate", async t => {
  const h = await harness(t)
  await h.command.run("https://example.com")
  assert.deepEqual(h.transitions, [])
  assert.ok(h.notices.some(n => n.variant === "error" && /annotate-web/.test(n.message)))
})

async function browserHarness(t, options = {}) {
  // Keep Unix socket paths below macOS's 104-byte limit and out of the live registry.
  const base = path.join(os.homedir(), ".cache")
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(path.join(base, "oa-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const opened = []
  const h = await harness(t, {
    ...options, web: { receiver: { root }, open: async url => { opened.push(url) } },
  })
  return { ...h, opened, targets: () => listTargets(root) }
}

test("web review from home creates an empty session and pins later feedback to it", async t => {
  const h = await browserHarness(t, { route: { type: "home" } })
  h.ctx.location = { directory: h.root }
  await h.command.web()
  assert.deepEqual(h.created, [{
    location: { directory: h.root }, model: { providerID: "fixture", id: "fixture", variant: "high" },
  }])
  assert.deepEqual(h.navigations, [{ type: "session", sessionID: "ses_original" }])
  const [target] = await h.targets()
  assert.equal(target.sessionID, "ses_original")
  assert.equal(target.directory, h.root)
  assert.deepEqual(h.sent, [], "pairing must not send a prompt")
  assert.equal(h.pages(), 0, "web review must not read assistant history")
  assert.deepEqual(h.transitions, [])
  assert.ok(h.notices.some(n => /Ready for browser pairing/.test(n.message)))

  await h.command.web()
  assert.equal(h.created.length, 1, "re-pairing reuses the empty session")
  assert.equal((await h.targets()).length, 1)
  h.setRoute({ type: "session", sessionID: "ses_other" })
  const receipt = await request(target.socket, {
    action: "send", targetID: target.id, batchID: randomUUID(),
    review: { version: 1, page: { url: "https://example.test/", title: "First review" }, annotations: [{
      id: "first-note", revision: 1, kind: "comment", comment: "Start with this page", createdAt: new Date().toISOString(),
      anchor: { type: "text", quote: "Alpha", selector: "#alpha" },
    }] },
  })
  assert.equal(receipt.state, "admitted", JSON.stringify(receipt))
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0].sessionID, "ses_original")
  assert.match(h.sent[0].text, /Start with this page/)

  h.setRoute({ type: "session", sessionID: "ses_original" })
  await h.command.web("off")
  assert.deepEqual(await h.targets(), [])
})

test("home webpage targets use the default location when no explicit location is set", async t => {
  for (const input of ["https://example.test/page", '"中文 page.html"']) {
    const sessionDir = await documentFolder(t)
    await writeFile(path.join(sessionDir, "中文 page.html"), "<h1>Page</h1>")
    const h = await browserHarness(t, { route: { type: "home" }, sessionDir })
    h.ctx.location = undefined
    await h.command.web(input)
    assert.equal(h.created.length, 1)
    assert.deepEqual(h.created[0].location, { directory: sessionDir })
    assert.equal((await h.targets())[0].directory, sessionDir)
    assert.equal(h.opened.length, 1)
    assert.equal(input.startsWith("https:") ? h.opened[0] : new URL(h.opened[0]).protocol,
      input.startsWith("https:") ? input : "file:")
    assert.deepEqual(h.sent, [])
  }
})

test("an in-flight home pairing captures its location and model without stealing another tab", async t => {
  const h = await browserHarness(t, { route: { type: "home" } })
  h.ctx.location = { directory: h.root }
  let entered, release
  const creating = new Promise(resolve => { entered = resolve })
  const ready = new Promise(resolve => { release = resolve })
  const create = h.ctx.client.session.create
  h.ctx.client.session.create = async input => {
    const session = await create(input)
    entered()
    await ready
    return session
  }
  const pairing = h.command.web()
  await creating
  await h.command.web()
  h.ctx.location = { directory: "/another-project" }
  h.ctx.ui.model.current = () => ({ providerID: "other", modelID: "other" })
  h.setRoute({ type: "session", sessionID: "ses_other" })
  release()
  await pairing
  assert.equal(h.created.length, 1)
  assert.equal(h.created[0].location.directory, h.root)
  assert.equal(h.created[0].model.id, "fixture")
  assert.deepEqual(h.navigations, [])
  assert.equal(h.ctx.ui.router.current().sessionID, "ses_other")
  assert.equal((await h.targets())[0].sessionID, "ses_original")
  assert.deepEqual(h.sent, [])
})

test("invalid targets, revocation and text commands do not create a session from home", async t => {
  for (const input of ["off", "web off", "notes.md", "javascript:alert(1)", "missing.html"]) {
    const h = await browserHarness(t, { route: { type: "home" } })
    h.ctx.location = { directory: h.root }
    await h.command.web(input)
    await h.command.run()
    await h.command.pick()
    await h.command.selection()
    assert.deepEqual(h.created, [], input)
    assert.deepEqual(h.navigations, [])
    assert.deepEqual(await h.targets(), [])
    assert.deepEqual(h.sent, [])
    assert.equal(h.pages(), 0)
    assert.ok(h.notices.length > 0)
  }
})

test("session creation failure leaves pairing retryable", async t => {
  const h = await browserHarness(t, { route: { type: "home" } })
  const create = h.ctx.client.session.create
  h.ctx.client.session.create = async () => { throw new Error("Session creation failed") }
  await h.command.web()
  assert.ok(h.notices.some(n => n.variant === "error" && /Session creation failed/.test(n.message)))
  assert.deepEqual(await h.targets(), [])
  assert.deepEqual(h.navigations, [])
  h.ctx.client.session.create = create
  await h.command.web()
  assert.equal((await h.targets()).length, 1)
})

test("disposing during session creation never registers or focuses the new session", async t => {
  const h = await browserHarness(t, { route: { type: "home" } })
  let entered, release
  const creating = new Promise(resolve => { entered = resolve })
  const ready = new Promise(resolve => { release = resolve })
  const create = h.ctx.client.session.create
  h.ctx.client.session.create = async input => {
    const session = await create(input)
    entered()
    await ready
    return session
  }
  const pairing = h.command.web()
  await creating
  await h.command.dispose()
  release()
  await pairing
  assert.deepEqual(await h.targets(), [])
  assert.deepEqual(h.navigations, [])
  assert.deepEqual(h.sent, [])
})

test("the picker offers progress updates and sends feedback on the chosen one", async t => {
  const h = await harness(t, { expectedText: progress })
  history(h)
  let offered
  h.ctx.ui.dialog.select = async input => {
    offered = input.options
    return "msg_progress"
  }
  await h.command.pick()
  assert.deepEqual(offered.map(option => option.value), ["msg_final", "msg_progress"])
  assert.match(offered[1].description, /^Progress update · /)
  assert.equal(h.sent.length, 1)
  assert.match(h.sent[0].text, /your progress update msg_progress\./)
})

test("a cancelled picker opens nothing", async t => {
  const h = await harness(t)
  history(h)
  h.ctx.ui.dialog.select = async () => undefined
  await h.command.pick()
  assert.deepEqual(h.transitions, [])
  assert.deepEqual(h.sent, [])
})

test("a transcript selection opens the message containing it, ignoring rendered markup", async t => {
  const h = await harness(t, { expectedText: progress })
  history(h)
  h.ctx.renderer.select("Flash timing\nfirst.")
  await h.command.selection()
  assert.equal(h.sent.length, 1)
  assert.match(h.sent[0].text, /your progress update msg_progress\./)
})

test("an unmatched selection is annotated on its own", async t => {
  const h = await harness(t, { expectedText: "Alpha paragraph. Not in history" })
  history(h)
  h.ctx.renderer.select("Alpha paragraph. Not in history")
  await h.command.selection()
  assert.equal(h.sent.length, 1)
  assert.match(h.sent[0].text, /text I selected in this session/)
})

test("without a selection in this session nothing opens", async t => {
  const h = await harness(t)
  await h.command.selection()
  assert.deepEqual(h.transitions, [])
  assert.ok(h.notices.some(n => /Select text/.test(n.message)))
})

test("a quoted relative document uses the captured session directory and returns its source path", async t => {
  const sessionDir = await documentFolder(t)
  const file = path.join(sessionDir, "设计 方案.md")
  const text = "# Document fixture\n\nAlpha paragraph.\n"
  await writeFile(file, text)
  const h = await harness(t, { sessionDir, expectedText: text, changeRoute: true })
  await h.command.run('"设计 方案.md"')
  assert.equal(h.pages(), 0, "Document reviews must not require an assistant reply")
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0].sessionID, "ses_original")
  assert.ok(h.sent[0].text.includes(file))
  assert.match(h.sent[0].text, /# Annotations on 设计 方案\.md/)
  assert.match(h.sent[0].text, /snapshot/)
  assert.doesNotMatch(h.sent[0].text, /msg_final/)
  assert.equal(await readFile(file, "utf8"), text)
  assert.deepEqual(await readdir(h.root), [])
})

test("absolute document paths keep recovery snapshots separate from exported feedback.md", async t => {
  const sessionDir = await documentFolder(t)
  const file = path.join(sessionDir, "feedback.md")
  const text = "# Document fixture\n\nAlpha paragraph.\n"
  await writeFile(file, text)
  const h = await harness(t, { sessionDir, expectedText: text, sendError: true })
  await h.command.run(file)
  const [retained] = await readdir(h.root)
  const draft = path.join(h.root, retained)
  assert.equal(await readFile(path.join(draft, "source", "feedback.md"), "utf8"), text)
  assert.match(await readFile(path.join(draft, "feedback.md"), "utf8"), /请补充具体例子。/)
  const metadata = JSON.parse(await readFile(path.join(draft, "review.json"), "utf8"))
  assert.equal(metadata.filePath, file)
  assert.equal(metadata.messageID, undefined)
  assert.equal(metadata.snapshot, "source/feedback.md")
  assert.match(metadata.sourceHash, /^[a-f0-9]{64}$/)
  assert.equal(await readFile(file, "utf8"), text)
})

for (const invalid of ["missing.md", "directory.md", "binary.txt", "large.txt"]) {
  test(`${invalid} fails before taking over the terminal or submitting a prompt`, async t => {
    const sessionDir = await documentFolder(t)
    const file = path.join(sessionDir, invalid)
    if (invalid === "directory.md") await mkdir(file)
    if (invalid === "binary.txt") await writeFile(file, Buffer.from([0, 255, 0, 1]))
    if (invalid === "large.txt") await writeFile(file, "x".repeat(2 * 1024 * 1024 + 1))
    const h = await harness(t, { sessionDir })
    await h.command.run(invalid)
    assert.deepEqual(h.transitions, [])
    assert.deepEqual(h.sent, [])
    assert.equal(h.pages(), 0)
    const error = h.notices.find(n => n.variant === "error")
    assert.ok(error, "A document error must be visible")
    assert.doesNotMatch(error.message, /Can't find Annotate TUI/)
    assert.deepEqual(await readdir(h.root), [])
  })
}
