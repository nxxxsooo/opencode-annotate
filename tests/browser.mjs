import { createServer } from "node:http"
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import os from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { installBridge } from "../scripts/install-bridge.mjs"
import { createReceiver } from "../bridge/receiver.mjs"
import { createWebReview } from "../web-review.mjs"

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || pathToFileURL(path.join(os.homedir(), ".agents/node_modules/playwright-core/index.mjs")).href)

const project = fileURLToPath(new URL("../", import.meta.url))
const artifacts = path.join(project, ".local/browser-test")
await mkdir(artifacts, { recursive: true })
const temp = await mkdtemp(path.join(os.homedir(), ".cache/oa-browser-"))
const html = `<!doctype html><html lang=en><meta charset=utf-8><title>\u200bAnnotate\u2060 review\ufeff fixture\u200d</title><style>body{font:18px/1.8 system-ui;padding:40px;max-width:700px}button{padding:12px}p{margin:24px 0}.css-hidden{display:none}</style><h1>Review a live webpage</h1><p id=duplicate>First: same text, context A. Second: same text, context B.</p><p id=unicode>Before 😀 <b>中文选区</b> after 🚀.</p><button id=target onclick="window.clicked=(window.clicked||0)+1">Run the workflow</button><p><span contenteditable>never-export-before</span><span id=public>Public text</span><span contenteditable>never-export-after</span></p><input id=password type=password value=never-export-password><section id=dashboard><h2>月度复盘</h2><p>Track attendance</p><button id=gear aria-label=Settings><svg aria-hidden=true width=24 height=24><title>never-export-icon</title><circle cx=12 cy=12 r=10 /></svg></button><input type=hidden value=never-export-hidden><textarea hidden>never-export-textarea</textarea><span class=css-hidden>never-export-css</span><div contenteditable>never-export-editor</div></section><canvas id=canvas width=50 height=20></canvas>`
const foreignServer = createServer((_request, response) => { response.setHeader("content-type", "text/html"); response.end('<p id="foreign">Foreign site text</p>') })
await new Promise(resolve => foreignServer.listen(0, "127.0.0.1", resolve))
const foreignURL = `http://127.0.0.1:${foreignServer.address().port}/foreign`
const fixtures = {
  "/frames/iframe": '<!doctype html><title>Iframe fixture</title><iframe id="child" src="/frames/inner" style="width:700px;height:400px"></iframe>',
  "/frames/legacy": '<!doctype html><html><head><title>Legacy fixture</title></head><frameset cols="50%,50%"><frame id="left" src="/frames/inner?left"><frame id="right" src="/frames/inner?right"></frameset></html>',
  "/frames/nested": '<!doctype html><title>Nested fixture</title><iframe id="outer" src="/frames/iframe" style="width:900px;height:600px"></iframe>',
  "/frames/foreign": `<!doctype html><title>Foreign fixture</title><iframe id="foreign" src="${foreignURL}" style="width:700px;height:400px"></iframe>`,
  "/frames/inner": '<!doctype html><title>Inner document</title><style>body{padding:30px}p{padding:20px}</style><p id="inside">Inner frame selectable text</p>',
}
const server = createServer((request, response) => { response.setHeader("content-type", "text/html"); response.end(fixtures[request.url.split("?")[0]] || html) })
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
const url = `http://127.0.0.1:${server.address().port}/fixture`
const targetsDirectory = path.join(temp, "targets")
const installation = await installBridge({ profileDirectory: path.join(temp, "chrome"), installRoot: path.join(temp, "host"), targetsDirectory })
const sent = []
let failNextDelivery = false
let context, panel, receiver
const additionalReceivers = []
const passed = []
try {
  context = await chromium.launchPersistentContext(path.join(temp, "chrome"), {
    executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
    headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${installation.extensionDirectory}`, `--load-extension=${installation.extensionDirectory}`, "--enable-unsafe-extension-debugging"],
  })
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker")
  await worker.evaluate(async () => {
    const deadline = Date.now() + 5000
    while (!chrome.action.onClicked.hasListeners()) {
      if (Date.now() > deadline) throw new Error("Extension action listener did not initialize")
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  })
  const page = await context.newPage(); await page.goto(url); await page.bringToFront()
  const cdp = await context.browser().newBrowserCDPSession()
  async function activate() {
    const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }, { exclude: true }] })
    const tab = targetInfos.find(t => t.url === page.url())
    await cdp.send("Extensions.triggerAction", { id: installation.extensionID, targetId: tab.targetId })
  }
  await activate()
  try { await page.waitForSelector("[data-opencode-annotate]", { state: "attached", timeout: 10000 }) }
  catch (error) {
    console.error(await worker.evaluate(async () => ({ session: await chrome.storage.session.get(null), tabs: await chrome.tabs.query({}) })))
    throw error
  }
  passed.push("Production activeTab action grants access and injects the HTML inspector")
  const panelEvent = context.waitForEvent("page", { predicate: p => p.url().includes("panel.html") })
  await worker.evaluate(async () => { await chrome.tabs.create({ url: chrome.runtime.getURL("panel.html"), active: false }) })
  panel = await panelEvent
  const errors = []; panel.on("pageerror", e => errors.push(e.message))
  await panel.locator("#page-title").filter({ hasText: "Annotate review fixture" }).waitFor()
  await panel.locator("#paired").filter({ hasText: /^No session$/ }).waitFor()
  await panel.evaluate(() => {
    // This test panel is a background tab; model a visible side panel's lifecycle.
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await panel.getByRole("button", { name: "Pick element", exact: true }).click()
  await page.locator("#public").click()
  await panel.locator("#quote").filter({ hasText: "Public text" }).waitFor()
  await panel.getByLabel("Your feedback").fill("Keep my draft while the session starts.")
  await panel.locator("#draft-state").filter({ hasText: "Draft saved locally" }).waitFor()
  receiver = await createReceiver({ root: targetsDirectory, sessionID: "ses_browser_test", title: "Browser test target", directory: "/isolated-test", resume: false,
    client: { session: { get: async () => ({}), prompt: async input => { if (failNextDelivery) { failNextDelivery = false; throw new Error("Temporary delivery failure (test)") } sent.push(input); return { id: input.id } } } } })
  await panel.locator("#link-state").filter({ hasText: "Live" }).waitFor({ timeout: 5000 })
  assert.equal(await panel.locator("#paired").textContent(), "Browser test target")
  assert.equal(await panel.getByLabel("Your feedback").inputValue(), "Keep my draft while the session starts.")
  assert.equal(sent.length, 0)
  await panel.getByRole("button", { name: "Discard draft", exact: true }).click()
  passed.push("A panel opened first discovers a new session promptly without reloading, losing its draft or sending")

  await panel.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime)
    window.connectionCalls = 0
    chrome.runtime.sendMessage = message => {
      if (message.action !== "connection") return send(message)
      window.connectionCalls++
      return new Promise((resolve, reject) => {
        window.releaseConnection = () => {
          chrome.runtime.sendMessage = send
          return send(message).then(resolve, reject)
        }
      })
    }
    window.dispatchEvent(new Event("focus"))
    document.getElementById("change-target").click()
  })
  assert.equal(await panel.evaluate(() => window.connectionCalls), 1)
  assert.equal(await panel.locator("#change-target").isDisabled(), true, "opening the destination popover must wait for the in-flight probe")
  await panel.evaluate(() => window.releaseConnection())
  await panel.locator("#change-target:enabled").waitFor({ state: "attached" })
  passed.push("Overlapping automatic and manual refreshes await one connection probe")
  await panel.reload()
  await panel.locator("#paired").filter({ hasText: "Browser test target" }).waitFor()
  await panel.locator("#page-title").filter({ hasText: "Annotate review fixture" }).waitFor()
  await panel.setViewportSize({ width: 320, height: 720 })
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-empty.png") })
  assert.equal(await panel.getByRole("button", { name: "Pair selected session", exact: true }).count(), 0)
  assert.equal(await panel.locator("#session-options").isVisible(), false)
  assert.equal((await worker.evaluate(() => chrome.storage.local.get("paired"))).paired, undefined)
  assert.equal(sent.length, 0)
  passed.push("A sole session is shown automatically without pairing steps or pre-send authorization")
  const draftWrites = await panel.evaluate(async () => {
    const current = await chrome.runtime.sendMessage({ action: "current" })
    const page = { ...current.page, url: `${current.page.url}/draft-boundary` }
    const value = { anchor: { type: "element", selector: "#target", quote: "Run the workflow" }, kind: "comment", comment: "Newest text", editing: null }
    const write = (writerID, sequence, baseRevision, text) => chrome.runtime.sendMessage({ action: "draft", page, writerID, sequence, baseRevision, value: text === null ? null : { ...value, comment: text } })
    const newest = await write("writer-a", 2, 0, "Newest text")
    const late = await write("writer-a", 1, 0, "Old text")
    const conflict = await write("writer-b", 1, 0, "Competing text")
    const resolved = await write("writer-b", 2, newest.draft.revision, "Explicitly kept version")
    const staleOwner = await write("writer-a", 3, newest.draft.revision, "Late former owner")
    const cleared = await write("writer-b", 3, resolved.draft.revision, null)
    const unchanged = await chrome.runtime.sendMessage({ action: "current" })
    return { newest, late, conflict, resolved, staleOwner, cleared, currentDraft: unchanged.draft }
  })
  assert.equal(draftWrites.late.draft.value.comment, "Newest text")
  assert.equal(draftWrites.conflict.code, "draft-conflict")
  assert.equal(draftWrites.staleOwner.code, "draft-conflict")
  assert.equal(draftWrites.resolved.draft.value.comment, "Explicitly kept version")
  assert.equal(draftWrites.cleared.draft.value, null)
  assert.equal(draftWrites.currentDraft.value, null)
  passed.push("Per-page drafts reject competing writers and late snapshots while preserving explicit conflict resolution")
  await panel.getByRole("button", { name: "Pick element", exact: true }).click()
  await panel.getByRole("button", { name: "Cancel pick (Esc)", exact: true }).waitFor()
  await page.locator("#dashboard").click({ position: { x: 5, y: 5 } })
  await panel.locator("#quote").filter({ hasText: "月度复盘" }).waitFor()
  assert.ok(!(await panel.locator("#quote").textContent()).includes("never-export"))
  assert.equal(await panel.getByRole("button", { name: "Pick element", exact: true }).getAttribute("aria-pressed"), "false")
  await panel.getByRole("button", { name: "Discard draft", exact: true }).click()
  await panel.getByRole("button", { name: "Pick element", exact: true }).click()
  await page.locator("#password").click()
  await panel.locator("#quote").filter({ hasText: "password control" }).waitFor()
  assert.ok(!(await panel.locator("#quote").textContent()).includes("never-export"))
  await panel.getByRole("button", { name: "Discard draft", exact: true }).click()
  passed.push("Containers with hidden SVG/editors are annotatable; input controls exclude their values")
  await panel.getByRole("button", { name: "Pick element", exact: true }).click()
  await page.locator("#canvas").click()
  await panel.getByRole("status").filter({ hasText: "unsupported" }).waitFor()
  assert.equal(await panel.getByRole("button", { name: "Pick element", exact: true }).getAttribute("aria-pressed"), "false")
  await page.locator("#target").click()
  assert.equal(await page.evaluate(() => window.clicked), 1)
  await panel.getByRole("button", { name: "Pick element", exact: true }).click()
  await page.locator("#gear svg").click()
  await panel.locator("#quote").filter({ hasText: "Settings" }).waitFor()
  assert.equal(await panel.getByRole("status").evaluate(el => el.classList.contains("error")), false)
  await panel.getByRole("button", { name: "Discard draft", exact: true }).click()
  passed.push("Failed picks exit interception immediately and a valid pick clears the old error")
  await panel.getByRole("button", { name: "Pick element", exact: true }).click()
  await panel.getByRole("button", { name: "Cancel pick (Esc)", exact: true }).waitFor()
  await activate()
  await panel.getByRole("button", { name: "Pick element", exact: true }).waitFor()
  assert.equal(await page.locator("[data-opencode-annotate]").count(), 1)
  await page.locator("#target").click()
  assert.equal(await page.evaluate(() => window.clicked), 2)
  passed.push("Reopening the tool cancels old picks and replaces listeners without duplicates")
  const select = async (selector, quote, occurrence = 0) => {
    await page.evaluate(({ selector, quote, occurrence }) => {
      const el = document.querySelector(selector), text = el.firstChild
      let at = -1
      for (let i = 0; i <= occurrence; i++) at = text.textContent.indexOf(quote, at + 1)
      const range = document.createRange(); range.setStart(text, at); range.setEnd(text, at + quote.length)
      getSelection().removeAllRanges(); getSelection().addRange(range)
    }, { selector, quote, occurrence })
    await panel.locator("#quote").filter({ hasText: quote }).waitFor()
  }
  const pick = async selector => {
    await panel.getByRole("button", { name: "Pick element", exact: true }).click()
    await panel.getByRole("button", { name: "Cancel pick (Esc)", exact: true }).waitFor()
    await page.locator(selector).click()
    await panel.getByRole("button", { name: "Pick element", exact: true }).waitFor()
  }
  await pick("#target")
  await panel.getByLabel("Your feedback").fill("Feedback belongs to the workflow button.")
  await panel.locator("#draft-state").filter({ hasText: "Draft saved locally" }).waitFor()
  await pick("#public")
  await panel.locator("#switch-notice").waitFor()
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-draft-switch.png") })
  assert.equal(await panel.locator("#quote").textContent(), "Run the workflow")
  assert.equal(await panel.getByLabel("Your feedback").inputValue(), "Feedback belongs to the workflow button.")
  await panel.getByRole("button", { name: "Keep editing", exact: true }).click()
  await pick("#public")
  await panel.getByRole("button", { name: "Discard & switch", exact: true }).click()
  await panel.locator("#quote").filter({ hasText: "Public text" }).waitFor()
  await panel.locator("#comment:enabled").waitFor()
  assert.equal(await panel.evaluate(() => document.activeElement.id), "comment")
  assert.equal(await panel.getByLabel("Your feedback").inputValue(), "")
  passed.push("Picking another element protects dirty feedback and each switch choice preserves the intended anchor")

  await panel.getByLabel("Your feedback").fill("Keep this unfinished draft through navigation.")
  await panel.locator("#draft-state").filter({ hasText: "Draft saved locally" }).waitFor()
  await page.evaluate(() => history.pushState({}, "", "/draft-other"))
  await panel.locator("#page-url").filter({ hasText: "/draft-other" }).waitFor()
  assert.equal(await panel.locator("#composer").isVisible(), false)
  await page.evaluate(() => history.back())
  await panel.waitForFunction(() => document.getElementById("comment").value === "Keep this unfinished draft through navigation.")
  await panel.reload()
  await panel.getByLabel("Your feedback").waitFor()
  assert.equal(await panel.getByLabel("Your feedback").inputValue(), "Keep this unfinished draft through navigation.")
  passed.push("Unfinished feedback restores across SPA routes and panel reload without requiring Add note")

  await worker.evaluate(() => {
    globalThis.originalStorageSet = chrome.storage.local.set.bind(chrome.storage.local)
    chrome.storage.local.set = async values => {
      if (Object.keys(values).some(key => key.startsWith("draft:"))) throw new Error("Storage is full (test)")
      return globalThis.originalStorageSet(values)
    }
  })
  await panel.getByLabel("Your feedback").fill("Keep this text after storage failure.")
  await panel.locator("#draft-error-text").filter({ hasText: "Storage is full" }).waitFor()
  assert.equal(await panel.getByLabel("Your feedback").inputValue(), "Keep this text after storage failure.")
  await worker.evaluate(() => { chrome.storage.local.set = globalThis.originalStorageSet; delete globalThis.originalStorageSet })
  await panel.getByRole("button", { name: "Retry saving draft", exact: true }).click()
  await panel.locator("#draft-error").waitFor({ state: "hidden" })
  passed.push("Storage failure keeps the input and exposes a working local-draft retry")

  await panel.evaluate(async () => {
    const current = await chrome.runtime.sendMessage({ action: "current" })
    const result = await chrome.runtime.sendMessage({ action: "draft", page: current.page, writerID: "competing-panel", sequence: 1,
      baseRevision: current.draft.revision, value: { ...current.draft.value, comment: "A competing panel version" } })
    if (!result.ok) throw new Error(result.error)
  })
  await panel.getByRole("button", { name: "Keep my draft", exact: true }).waitFor()
  assert.equal(await panel.getByLabel("Your feedback").inputValue(), "Keep this text after storage failure.")
  await panel.getByRole("button", { name: "Keep my draft", exact: true }).click()
  await panel.locator("#draft-error").waitFor({ state: "hidden" })
  const keptDraft = await panel.evaluate(() => chrome.runtime.sendMessage({ action: "current" }))
  assert.equal(keptDraft.draft.value.comment, "Keep this text after storage failure.")
  passed.push("A competing panel draft prompts explicit resolution without replacing the local input")

  await panel.getByRole("button", { name: "Discard draft", exact: true }).click()
  await panel.locator("#composer").waitFor({ state: "hidden" })
  await panel.locator("#pick:enabled").waitFor()
  assert.equal(await panel.evaluate(() => document.activeElement.id), "pick")
  await panel.reload()
  await panel.locator("#page-title").filter({ hasText: "Annotate review fixture" }).waitFor()
  await panel.locator("#composer").waitFor({ state: "hidden" })
  await pick("#public")
  await panel.locator("#quote").filter({ hasText: "Public text" }).waitFor()
  await panel.getByLabel("Your feedback").fill("Queue this note before changing the selection.")
  await pick("#target")
  await panel.getByRole("button", { name: "Add & switch", exact: true }).click()
  await panel.locator("#quote").filter({ hasText: "Run the workflow" }).waitFor()
  await panel.locator("#comment:enabled").waitFor()
  assert.equal(await panel.evaluate(() => document.activeElement.id), "comment")
  await panel.reload()
  await panel.locator("#quote").filter({ hasText: "Run the workflow" }).waitFor()
  assert.equal(await panel.getByLabel("Your feedback").inputValue(), "")
  assert.equal(await panel.locator("#notes .note-target span").textContent(), "Public text")
  await panel.getByRole("button", { name: "Delete note 1", exact: true }).click()
  await panel.locator("#undo:enabled").waitFor()
  assert.equal(await panel.evaluate(() => document.activeElement.id), "undo")
  await panel.getByRole("button", { name: "Undo", exact: true }).click()
  await panel.getByRole("button", { name: "Show note 1 on page", exact: true }).waitFor()
  await panel.waitForFunction(() => !document.querySelector("#notes .note-target").disabled)
  assert.equal(await panel.evaluate(() => document.activeElement.getAttribute("aria-label")), "Show note 1 on page")
  await panel.getByRole("button", { name: "Delete note 1", exact: true }).click()
  await panel.waitForFunction(() => document.querySelectorAll("#notes li").length === 0)
  await panel.getByRole("button", { name: "Discard draft", exact: true }).click()
  passed.push("Discard permits same-element reselection; Add & switch and visible Delete/Undo preserve note identity")

  await select("#duplicate", "same text", 1)
  await panel.getByLabel("Your feedback").fill("Explain the second occurrence, not the first.")
  await panel.getByRole("radio", { name: "Question", exact: true }).click()
  await panel.getByLabel("Your feedback").focus()
  await panel.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter")
  await panel.getByRole("status").filter({ hasText: "Saved locally" }).waitFor()
  await panel.locator("#pick:enabled").waitFor()
  assert.equal(await panel.evaluate(() => document.activeElement.id), "pick")
  assert.ok((await panel.locator("#preview").textContent()).includes("Second: 【same text】, context B."))
  assert.equal(await page.locator("body").evaluate(el => el.textContent.includes("Explain the second occurrence")), false)
  passed.push("Exact duplicate selection, complete context, and private comment UI")

  await panel.getByRole("button", { name: "Pick element", exact: true }).click()
  await page.locator("#target").click()
  await panel.locator("#quote").filter({ hasText: "Run the workflow" }).waitFor()
  await panel.getByLabel("Your feedback").fill("Rename this button to Start.")
  await panel.getByRole("button", { name: "Add note", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Saved locally" }).waitFor()
  await panel.locator("#pick:enabled").waitFor()
  assert.equal(await panel.evaluate(() => document.activeElement.id), "pick")
  assert.equal(await page.evaluate(() => window.clicked), 2)
  passed.push("Element picking blocks the original action")
  passed.push("Save, shortcut Save, switching, Discard, Delete, and Undo hand focus to enabled controls")

  await select("#public", "Public text")
  await panel.getByLabel("Your feedback").fill("Adjacent editors must stay private.")
  await panel.getByRole("button", { name: "Add note", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Saved locally" }).waitFor()
  assert.ok(!(await panel.locator("#preview").textContent()).includes("never-export"))
  await panel.getByRole("button", { name: "More review options", exact: true }).click()
  const downloadPromise = panel.waitForEvent("download")
  await panel.getByRole("button", { name: "Export JSON", exact: true }).click()
  const exported = JSON.parse(await readFile(await (await downloadPromise).path(), "utf8"))
  assert.equal(exported.annotations.length, 3)
  assert.ok(exported.annotations[0].anchor.styles)
  assert.equal(exported.version, 2)
  assert.equal(exported.annotations[0].page.url, url)
  assert.equal(exported.annotations[0].page.title, "Annotate review fixture")
  await panel.getByRole("button", { name: "More review options", exact: true }).click()
  passed.push("Complete JSON export includes styles/URL and excludes adjacent editors")
  await panel.locator("#panel-body").evaluate(node => { node.scrollTop = 0 })
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-notes.png") })

  await page.reload(); await activate(); await page.waitForSelector("[data-opencode-annotate]", { state: "attached" })
  await panel.waitForFunction(() => document.querySelectorAll("#notes .note").length === 3)
  await page.evaluate(() => history.pushState({}, "", "/other"))
  await panel.locator("#page-url").filter({ hasText: "/other" }).waitFor()
  await panel.waitForFunction(() => document.querySelectorAll("#notes .note").length === 3)
  await page.evaluate(() => history.back())
  await panel.waitForFunction(() => document.querySelectorAll("#notes .note").length === 3)
  passed.push("Reload restores drafts; SPA routes retain the global round")

  await panel.getByRole("button", { name: "Send 3 notes", exact: true }).click()
  assert.equal(await panel.locator("#link-state").textContent(), "Live")
  assert.equal(await panel.locator("#copy-round").isVisible(), true)
  await panel.getByRole("status").filter({ hasText: "Sent 3 notes to Browser test target" }).waitFor()
  assert.equal(sent.length, 1); assert.equal(sent[0].sessionID, "ses_browser_test"); assert.equal(sent[0].resume, false)
  assert.equal(sent[0].delivery, "steer")
  assert.ok(sent[0].text.includes("Explain the second occurrence"))
  await panel.waitForFunction(() => document.querySelectorAll("#notes li").length === 0)
  await panel.locator("#empty-title").filter({ hasText: "Ready for the next round." }).waitFor()
  assert.equal(await panel.getByRole("button", { name: "Restore last round", exact: true }).isVisible(), true)
  await panel.locator("#pick:enabled").waitFor()
  assert.equal(await panel.evaluate(() => document.activeElement.id), "pick")
  await panel.reload()
  await panel.locator("#empty-title").filter({ hasText: "Ready for the next round." }).waitFor()
  assert.equal(await panel.locator("#composer").isVisible(), false)
  passed.push("Consumed captures stay completed across panel reload while genuine newer selections still open")
  await panel.locator("#panel-body").evaluate(node => { node.scrollTop = 0 })
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-sent.png") })
  passed.push("One Send click delivers the round, clears the list and leaves the next round ready")

  await page.reload()
  await page.waitForSelector("[data-opencode-annotate]", { state: "attached", timeout: 10000 })
  await pick("#target")
  await panel.getByLabel("Your feedback").fill("Rename the second round button.")
  await panel.getByRole("button", { name: "Add note", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Saved locally" }).waitFor()
  assert.equal(await panel.locator("#page-error").isVisible(), false)
  passed.push("A page reload reconnects the page tools without clicking the extension icon")

  const clicksBeforeReveal = await page.evaluate(() => window.clicked || 0)
  const restored = await panel.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ action: "current" })
    const note = state.notes[0]
    const shown = await chrome.runtime.sendMessage({ action: "reveal", url: state.page.url, noteID: note.id })
    const removed = await chrome.runtime.sendMessage({ action: "delete", url: state.page.url, note, baseRevision: note.revision })
    const undone = await chrome.runtime.sendMessage({ action: "restore", url: state.page.url, note: removed.note, baseRevision: removed.note.revision })
    const staleUndo = await chrome.runtime.sendMessage({ action: "restore", url: state.page.url, note: removed.note, baseRevision: removed.note.revision })
    return { shown, undone, staleUndo }
  })
  assert.equal(restored.shown.ok, true)
  assert.equal(await page.evaluate(() => window.clicked || 0), clicksBeforeReveal)
  assert.equal(restored.undone.ok, true)
  assert.equal(restored.staleUndo.ok, false)
  passed.push("Show on page never activates the target; Undo restores the note and rejects stale restoration")

  const other = await createReceiver({ root: targetsDirectory, sessionID: "ses_other", title: "Other session", directory: "/other-test", resume: false,
    client: { session: { get: async () => ({}), prompt: async () => { throw new Error("Must not send to the other session") } } } })
  additionalReceivers.push(other)
  await panel.evaluate(() => chrome.storage.local.remove(["paired", "disconnected"]))
  await panel.getByLabel("Destination session", { exact: true }).waitFor()
  await panel.locator("#paired").filter({ hasText: "Choose a session" }).waitFor()
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-destination.png") })
  assert.equal(await panel.getByRole("button", { name: "Send 1 note", exact: true }).isEnabled(), true)
  assert.equal(await panel.locator("#copy-round").isVisible(), true)
  assert.ok((await panel.locator("#status").textContent()).includes("Choose the session"))
  await pick("#unicode")
  await panel.getByLabel("Your feedback").fill("Keep typing while sessions refresh.")
  await panel.evaluate(() => { window.dispatchEvent(new Event("focus")); document.getElementById("comment").focus() })
  await panel.waitForTimeout(100)
  assert.equal(await panel.evaluate(() => document.activeElement.id), "comment")
  await panel.getByRole("button", { name: "Discard draft", exact: true }).click()
  const now = Date.now()
  // An old session with fresh activity must lead; registration-time titles must be replaced by live ones.
  const extras = await Promise.all(Array.from({ length: 6 }, (_, index) => createReceiver({ root: targetsDirectory, sessionID: `ses_extra_${index}`,
    title: `ses_extra_${index}`, directory: `/extra-${index}`, resume: false,
    client: { session: { get: async () => ({ title: `Old project ${index}`, time: { created: now - (index + 10) * 86400000,
      updated: index ? now - index * 3600000 : Date.now() } }), prompt: async () => { throw new Error("Must not send to an extra session") } } } })))
  const rows = panel.locator("#targets .session-row")
  await rows.first().locator(".session-title").filter({ hasText: "Old project 0" }).waitFor()
  assert.equal(await rows.count(), 6)
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-session-picker.png") })
  assert.equal(await panel.locator("#show-all-sessions").textContent(), "Show all 8")
  assert.equal(await panel.locator("#targets").getByText(/^ses_extra/).count(), 0)
  await panel.locator("#show-all-sessions").click()
  assert.equal(await rows.count(), 8)
  await panel.getByLabel("Sort sessions").selectOption("title")
  assert.equal(await rows.first().locator(".session-title").textContent(), "Browser test target")
  await panel.getByLabel("Sort sessions").selectOption("updated")
  await panel.getByLabel("Filter sessions").fill("browser test")
  assert.equal(await rows.count(), 1)
  await panel.getByLabel("Filter sessions").press("Enter")
  await panel.locator("#paired").filter({ hasText: "Browser test target" }).waitFor()
  assert.equal(await panel.locator("#session-options").isVisible(), false)
  await Promise.all(extras.map(extra => extra.close()))
  assert.equal(sent.length, 1)
  passed.push("Multiple sessions require one choice and connection refresh never steals typing focus")
  passed.push("The session picker leads with recent activity, shows live titles, and filters with Enter to choose")

  await panel.getByRole("button", { name: "Edit note 1", exact: true }).click()
  await panel.getByLabel("Your feedback").fill("Revised question after sending.")
  await panel.setViewportSize({ width: 420, height: 780 })
  await panel.locator("#panel-body").evaluate(node => { node.scrollTop = 0 })
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel.png"), fullPage: true })
  await panel.setViewportSize({ width: 320, height: 720 })
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-narrow.png"), fullPage: true })
  for (const viewport of [{ width: 320, height: 720 }, { width: 420, height: 780 }, { width: 210, height: 390 }]) {
    await panel.setViewportSize(viewport)
    await panel.getByLabel("Your feedback").focus()
    await panel.keyboard.press("Tab")
    const layout = await panel.evaluate(() => {
      const body = document.getElementById("panel-body"), footer = document.querySelector("footer"), focused = document.activeElement
      const rect = focused.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return { id: focused.id, visible: focused === hit || focused.contains(hit), width: body.clientWidth, scrollWidth: body.scrollWidth,
        footerWidth: footer.clientWidth, footerScrollWidth: footer.scrollWidth,
        bottom: rect.bottom, footerTop: footer.getBoundingClientRect().top, mainBottom: body.getBoundingClientRect().bottom }
    })
    assert.equal(layout.id, "save")
    assert.equal(layout.visible, true)
    assert.equal(layout.width, layout.scrollWidth)
    assert.equal(layout.footerWidth, layout.footerScrollWidth)
    assert.equal(layout.mainBottom, layout.footerTop)
    assert.ok(layout.bottom < layout.footerTop)
    if (viewport.width === 210 && !process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-zoom.png") })
  }
  await panel.setViewportSize({ width: 320, height: 720 })
  passed.push("Narrow, wide, and 200% reflow keep keyboard-focused actions visible above the delivery bar")
  await panel.getByRole("button", { name: "Send 1 note", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Ready for the next round" }).waitFor()
  assert.equal(sent.length, 2)
  assert.ok(sent[1].text.includes("Revised question")); assert.ok(!sent[1].text.includes("Rename this button"))
  await pick("#unicode")
  await panel.getByLabel("Your feedback").fill("Explain this Unicode label.")
  await panel.getByRole("button", { name: "Send 1 note", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Ready for the next round" }).waitFor()
  assert.equal(sent.length, 3)
  assert.ok(sent[2].text.includes("Explain this Unicode label."))
  assert.ok(!sent[2].text.includes("Revised question"))
  passed.push("A fresh annotation sends directly and includes only the new feedback")
  const addNote = async (selector, text) => {
    await pick(selector)
    await panel.getByLabel("Your feedback").fill(text)
    await panel.getByRole("button", { name: "Add note", exact: true }).click()
    await panel.getByRole("status").filter({ hasText: "Saved locally" }).waitFor()
  }
  await addNote("#public", "Retry this saved feedback.")
  failNextDelivery = true
  await panel.getByRole("button", { name: "Send 1 note", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Temporary delivery failure" }).waitFor()
  const previousTargetID = receiver.target.id
  await receiver.close()
  receiver = await createReceiver({ root: targetsDirectory, sessionID: "ses_browser_test", title: "Browser test target", directory: "/isolated-test", resume: false,
    client: { session: { get: async () => ({}), prompt: async input => { sent.push(input); return { id: input.id } } } } })
  const discoveredReplacement = await panel.evaluate(() => chrome.runtime.sendNativeMessage("fun.mjshao.annotate", { action: "targets" }))
  assert.ok(discoveredReplacement.targets?.some(target => target.id === receiver.target.id), JSON.stringify({ receiver: receiver.target, discoveredReplacement }))
  await panel.evaluate(() => window.dispatchEvent(new Event("focus")))
  const reboundDeadline = Date.now() + 5000
  while (true) {
    const paired = await panel.evaluate(() => chrome.runtime.sendMessage({ action: "pairing" }))
    if (paired.target?.sessionID === "ses_browser_test" && paired.target.id !== previousTargetID) break
    if (Date.now() > reboundDeadline) throw new Error(`Receiver did not rebind: ${JSON.stringify({ previousTargetID, paired })}`)
    await panel.waitForTimeout(50)
  }
  const rebound = await panel.evaluate(async () => ({
    paired: (await chrome.runtime.sendMessage({ action: "pairing" })).target,
    outbox: (await chrome.runtime.sendMessage({ action: "current" })).outbox,
  }))
  assert.equal(rebound.outbox.targetID, rebound.paired.id, "retry batch must move to the replacement receiver")
  const replacementInfo = await panel.evaluate(targetID => chrome.runtime.sendNativeMessage("fun.mjshao.annotate", { action: "info", targetID }), rebound.paired.id)
  assert.equal(replacementInfo.ok, true, JSON.stringify(replacementInfo))
  await pick("#unicode")
  await panel.getByLabel("Your feedback").fill("Keep this new feedback local during retry.")
  await panel.getByRole("button", { name: "Retry 1 note", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Ready for the next round" }).waitFor()
  assert.equal(sent.length, 4)
  assert.ok(sent[3].text.includes("Retry this saved feedback."))
  assert.ok(!sent[3].text.includes("Keep this new feedback local during retry."))
  assert.equal(await panel.getByLabel("Your feedback").inputValue(), "Keep this new feedback local during retry.")
  await panel.getByRole("button", { name: "Discard draft", exact: true }).click()
  passed.push("A restarted receiver rebinds by stable session identity and retries its original batch without touching new feedback")
  await addNote("#public", "Guard against duplicate sends.")
  const duplicateSend = await panel.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ action: "current" })
    const targetID = (await chrome.runtime.sendMessage({ action: "pairing" })).target.id
    return Promise.all([1, 2].map(() => chrome.runtime.sendMessage({ action: "send", url: state.page.url, targetID })))
  })
  assert.equal(duplicateSend.filter(result => result.ok).length, 1)
  assert.equal(sent.length, 5)
  passed.push("Simultaneous send requests cannot create duplicate batches after acknowledgement")
  await addNote("#target", "Copy this round without a session.")
  const conflicts = await panel.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ action: "current" })
    const note = state.notes[0]
    return Promise.all([1, 2].map(() => chrome.runtime.sendMessage({ action: "save", url: state.page.url, note, baseRevision: note.revision })))
  })
  assert.equal(conflicts.filter(result => result.ok).length, 1)
  assert.ok(conflicts.some(result => result.error?.includes("another tab")))
  passed.push("Concurrent note revisions reject stale writes instead of overwriting")
  await page.locator("#target").evaluate(node => node.remove())
  const locations = await panel.evaluate(() => chrome.runtime.sendMessage({ action: "current" }))
  assert.ok(locations.anchorStates.includes("missing"))
  await panel.getByRole("button", { name: "Show note 1 on page", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "missing" }).waitFor()
  await panel.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("denied") }; document.execCommand = () => false })
  await panel.getByRole("button", { name: "More review options", exact: true }).click()
  await panel.getByRole("button", { name: "Copy Markdown", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Automatic copy was blocked" }).waitFor()
  passed.push("Removed targets are flagged and clipboard denial exposes manual recovery")
  await receiver.close()
  const offline = await panel.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ action: "current" })
    const targetID = (await chrome.runtime.sendMessage({ action: "pairing" })).target.id
    return chrome.runtime.sendMessage({ action: "send", url: state.page.url, targetID })
  })
  assert.equal(offline.ok, false)
  assert.ok(offline.error.includes("offline"))
  assert.equal(sent.length, 5)
  const pending = await worker.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).filter(([key]) => key === "outbox"))
  assert.equal(pending.length, 1)
  const stale = await panel.evaluate(() => chrome.runtime.sendMessage({ action: "connection" }))
  assert.equal(stale.targets.length, 1)
  assert.equal(stale.target, null)
  assert.equal(stale.stale, true)
  passed.push("Offline paired target retains a retryable outbox without rerouting")
  await panel.getByRole("button", { name: "More review options", exact: true }).click()
  await panel.getByRole("button", { name: "Change destination session", exact: true }).click()
  await panel.locator("#paired").filter({ hasText: "Browser test target" }).waitFor()
  await panel.getByRole("button", { name: "Retry 1 note", exact: true }).waitFor()
  await panel.locator("#link-state").filter({ hasText: "Offline" }).waitFor()
  assert.ok((await panel.locator("#status").textContent()).includes("Session offline"))
  assert.equal(await panel.locator("#link-state").textContent(), "Offline")
  assert.equal(await panel.locator("#status").evaluate(node => node.classList.contains("error")), false)
  assert.equal(await panel.locator("#copy-round").isVisible(), true)
  await pick("#public")
  await panel.getByLabel("Your feedback").fill("Copy this unsaved draft too.")
  await panel.locator("#draft-state").filter({ hasText: "Draft saved locally" }).waitFor()
  await panel.evaluate(() => {
    // Mirrors Chrome: a clipboard write after a storage round trip has lost the click.
    const send = chrome.runtime.sendMessage.bind(chrome.runtime)
    chrome.runtime.sendMessage = message => { if (message.action === "save") window.storageFirst = true; return send(message) }
    navigator.clipboard.writeText = async text => { if (window.storageFirst) throw new Error("Document is not focused."); window.copiedRound = text }
  })
  await panel.locator("#copy-round").click()
  await panel.getByRole("status").filter({ hasText: "Copied 2 notes" }).waitFor()
  const copied = await panel.evaluate(() => window.copiedRound)
  assert.ok(copied.includes("Copy this round without a session.") && copied.includes("Copy this unsaved draft too."))
  assert.ok(copied.includes("## Annotate review fixture\n"))
  await panel.waitForFunction(() => document.querySelectorAll("#notes li").length === 0)
  assert.ok((await panel.locator("#empty-footnote").textContent()).includes("2 notes copied"))
  passed.push("Copy writes the clipboard within the click, before saving the open draft, with clean page titles")
  const afterCopy = await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter(key => key === "outbox"))
  assert.equal(afterCopy.length, 0)
  await panel.getByRole("button", { name: "Send notes", exact: true }).waitFor()
  passed.push("Without a live session, Copy delivers the round, supersedes the failed batch and clears the list")
  await panel.getByRole("button", { name: "Restore last round", exact: true }).click()
  await panel.waitForFunction(() => document.querySelectorAll("#notes .note").length === 2)
  assert.ok((await panel.locator("#notes .note-comment").first().textContent()).includes("Copy this round without a session."))
  await panel.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("Document is not focused.") }; delete document.execCommand })
  await panel.locator("#copy-round").click()
  await panel.getByRole("status").filter({ hasText: "Copied 2 notes" }).waitFor()
  passed.push("A refused async clipboard write falls back to the extension's legacy copy permission")
  await panel.getByRole("button", { name: "Restore last round", exact: true }).click()
  await panel.waitForFunction(() => document.querySelectorAll("#notes .note").length === 2)
  passed.push("The last delivered round can be restored into the working list")
  await panel.emulateMedia({ colorScheme: "dark" }); await panel.setViewportSize({ width: 420, height: 780 })
  await panel.locator("#panel-body").evaluate(node => { node.scrollTop = 0 })
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-dark.png"), fullPage: true })
  await panel.setViewportSize({ width: 320, height: 720 })
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-dark-narrow.png") })

  // Run extension session controls through the production worker, native host and
  // OpenCode adapter. The fake SDK records session creation and never runs a model.
  const creations = [], createdSessions = new Map(), newPrompts = []
  let route = { type: "home" }, failCreation = true, failNewDelivery = false
  const webContext = { location: { directory: "/browser-workspace" },
    ui: { router: { current: () => route, navigate: next => { route = next } }, dialog: { clear() {} },
      model: { current: () => ({ providerID: "fixture", modelID: "chosen", variant: "high" }) }, toast: { show() {} } },
    data: { on: () => () => {}, session: { status: () => "idle" } },
    client: { session: {
      get: async ({ sessionID }) => createdSessions.get(sessionID),
      create: async input => {
        if (failCreation) throw new Error("Session creation temporarily unavailable")
        creations.push(input)
        const session = { ...input, id: `ses_browser_created_${creations.length}`, title: `Fresh browser session ${creations.length}` }
        createdSessions.set(session.id, session); return session
      },
      prompt: async input => { if (failNewDelivery) throw new Error("Delivery interrupted (test)"); newPrompts.push(input); return { id: input.id } },
    } },
  }
  const webOptions = { autoRegister: true, receiver: { root: targetsDirectory, resume: false } }
  let web = createWebReview(webContext, webOptions)
  additionalReceivers.push({ close: () => web.dispose() })
  await web.ready()
  await pick("#public")
  await panel.getByLabel("Your feedback").fill("Keep this draft across session controls.")
  await panel.locator("#draft-state").filter({ hasText: "Draft saved locally" }).waitFor()
  const notesBeforeControls = await panel.locator("#notes").innerText()
  await panel.getByRole("button", { name: "Change destination session", exact: true }).click()
  if (!await panel.locator("#session-options").isVisible()) await panel.getByRole("button", { name: "Change destination session", exact: true }).click()
  const workspaceButton = panel.getByRole("button", { name: "New session in browser-workspace" })
  await workspaceButton.waitFor()
  assert.equal(creations.length, 0)
  await workspaceButton.click()
  await panel.locator("#status").filter({ hasText: "Session creation temporarily unavailable" }).waitFor()
  assert.equal(await panel.locator("#paired").textContent(), "Browser test target")
  failCreation = false
  await workspaceButton.click()
  await panel.locator("#paired").filter({ hasText: "Fresh browser session 1" }).waitFor()
  assert.deepEqual(creations, [{ location: { directory: "/browser-workspace" }, model: { providerID: "fixture", id: "chosen", variant: "high" } }])
  assert.equal(route.sessionID, "ses_browser_created_1")
  assert.deepEqual(newPrompts, [])
  assert.equal(await panel.locator("#notes").innerText(), notesBeforeControls)
  assert.equal(await panel.getByLabel("Your feedback").inputValue(), "Keep this draft across session controls.")
  passed.push("The destination menu creates an empty session from OpenCode home, retries failures and preserves local feedback")

  await panel.getByRole("button", { name: "Change destination session", exact: true }).click()
  await panel.locator("#new-session:enabled").waitFor({ state: "attached" })
  for (const [colorScheme, viewport] of [["light", { width: 420, height: 780 }], ["dark", { width: 320, height: 720 }], ["light", { width: 210, height: 390 }]]) {
    await panel.emulateMedia({ colorScheme }); await panel.setViewportSize(viewport)
    await panel.getByRole("button", { name: "New session", exact: true }).scrollIntoViewIfNeeded()
    const layout = await panel.locator("#session-options").evaluate(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }))
    assert.equal(layout.width, layout.scrollWidth, "session controls must reflow without horizontal scrolling")
    assert.ok((await panel.locator("#session-filter").boundingBox()).width > 100, "the filter must stay readable at zoom")
    if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, `panel-session-controls-${colorScheme}-${viewport.width}.png`) })
    await panel.getByRole("button", { name: "New session", exact: true }).focus()
    await panel.keyboard.press("Tab")
    assert.equal(await panel.evaluate(() => document.activeElement.id), "disconnect")
    const disconnectBox = await panel.locator("#disconnect").boundingBox()
    assert.ok(disconnectBox.y >= 0 && disconnectBox.y + disconnectBox.height <= viewport.height)
  }
  await panel.setViewportSize({ width: 320, height: 720 })
  await worker.evaluate(() => {
    const send = chrome.runtime.sendNativeMessage.bind(chrome.runtime)
    chrome.runtime.sendNativeMessage = async (...args) => {
      const result = await send(...args)
      if (args[1]?.action === "create-session" && result.ok) {
        chrome.runtime.sendNativeMessage = send
        throw new Error("Session creation reply lost (test)")
      }
      return result
    }
  })
  route = { type: "session", sessionID: "ses_elsewhere" }
  await panel.getByRole("button", { name: "New session", exact: true }).click()
  await panel.locator("#status").filter({ hasText: "Session creation reply lost" }).waitFor()
  assert.equal(creations.length, 2)
  await panel.getByRole("button", { name: "New session", exact: true }).click()
  await panel.locator("#paired").filter({ hasText: "Fresh browser session 2" }).waitFor()
  assert.equal(creations.length, 2, "retrying a lost acknowledgement must not create a duplicate")
  assert.deepEqual(creations[1], creations[0], "new sessions inherit the chosen destination's location and model")
  assert.equal(route.sessionID, "ses_elsewhere", "browser creation must not steal another terminal tab")
  assert.deepEqual(newPrompts, [])
  passed.push("New session inherits the chosen project/model, deduplicates a lost reply and does not steal terminal focus")

  failNewDelivery = true
  const interrupted = await panel.evaluate(async () => {
    const target = (await chrome.runtime.sendMessage({ action: "pairing" })).target
    return chrome.runtime.sendMessage({ action: "send", targetID: target.id })
  })
  assert.equal(interrupted.ok, false)
  failNewDelivery = false
  await panel.getByRole("button", { name: "Change destination session", exact: true }).click()
  await panel.getByRole("button", { name: "Disconnect", exact: true }).click()
  await panel.locator("#link-state").filter({ hasText: "Disconnected" }).waitFor()
  const rejectedSend = await panel.evaluate(async () => {
    const target = (await chrome.runtime.sendMessage({ action: "pairing" })).target
    return chrome.runtime.sendMessage({ action: "send", targetID: target.id })
  })
  assert.equal(rejectedSend.ok, false)
  assert.match(rejectedSend.error, /disconnected/)
  await panel.reload()
  await panel.locator("#link-state").filter({ hasText: "Disconnected" }).waitFor()
  await panel.getByLabel("Your feedback").waitFor()
  assert.equal(await panel.getByLabel("Your feedback").inputValue(), "Keep this draft across session controls.")
  assert.equal(await panel.locator("#notes").innerText(), notesBeforeControls)
  const beforeRestart = await panel.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ action: "current" })
    return state.outbox.targetID
  })
  await web.dispose()
  route = { type: "session", sessionID: "ses_browser_created_2" }
  web = createWebReview(webContext, webOptions)
  await web.ready()
  await panel.getByRole("button", { name: "Change destination session", exact: true }).click()
  await panel.locator("#targets .session-row:enabled").filter({ hasText: "Fresh browser session 2" }).click()
  await panel.locator("#link-state").filter({ hasText: "Live" }).waitFor()
  const afterReconnect = await panel.evaluate(async () => ({
    paired: (await chrome.runtime.sendMessage({ action: "pairing" })).target,
    outbox: (await chrome.runtime.sendMessage({ action: "current" })).outbox,
  }))
  assert.notEqual(afterReconnect.paired.id, beforeRestart)
  assert.equal(afterReconnect.outbox.targetID, afterReconnect.paired.id)
  assert.deepEqual(newPrompts, [])
  passed.push("Disconnect survives reload; explicit reconnect after receiver restart preserves retries, notes and drafts without sending")
  // Start a clean isolated round without disturbing destination/session fixtures.
  await worker.evaluate(async () => {
    const keys = Object.keys(await chrome.storage.local.get(null)).filter(key => /^(note:|draft:|outbox$)/.test(key))
    await chrome.storage.local.remove(keys)
  })
  const crossSent = []
  const crossReceiver = await createReceiver({ root: targetsDirectory, sessionID: "ses_cross_page", title: "Cross-page target", directory: "/isolated-test", resume: false,
    client: { session: { get: async () => ({}), prompt: async input => { crossSent.push(input); return { id: input.id } } } } })
  additionalReceivers.push(crossReceiver)
  await panel.evaluate(target => chrome.runtime.sendMessage({ action: "pair", target }), crossReceiver.target)
  await page.goto(url); await activate(); await panel.reload()
  await panel.locator("#paired").filter({ hasText: "Cross-page target" }).waitFor()
  await pick("#public")
  await panel.getByLabel("Your feedback").fill("Page A feedback")
  await panel.getByRole("button", { name: "Add note", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Saved locally" }).waitFor()
  await page.goto(`${url}/second`); await activate()
  await panel.locator("#page-url").filter({ hasText: "/second" }).waitFor()
  await pick("#public")
  await panel.getByLabel("Your feedback").fill("Page B feedback")
  await panel.getByRole("button", { name: "Add note", exact: true }).click()
  await panel.locator("#count").filter({ hasText: "2 notes in this round · 2 pages" }).waitFor()
  assert.equal(await panel.locator(".page-group").count(), 2)
  assert.deepEqual(await panel.locator(".note-number").allTextContents(), ["1", "2"])
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-cross-page.png") })
  assert.equal(await panel.locator(".warning").filter({ hasText: "elsewhere" }).count(), 0)
  const globalState = await panel.evaluate(() => chrome.runtime.sendMessage({ action: "current" }))
  assert.deepEqual(globalState.anchorStates, ["elsewhere", "located"])
  await panel.getByRole("button", { name: "Delete note 1", exact: true }).click()
  await panel.locator("#count").filter({ hasText: "1 note in this round" }).waitFor()
  await panel.getByRole("button", { name: "Undo", exact: true }).click()
  await panel.locator("#count").filter({ hasText: "2 notes in this round · 2 pages" }).waitFor()
  // Showing an off-page target navigates back, with all feedback still in the round.
  await panel.getByRole("button", { name: "Show note 1 on page", exact: true }).click()
  await panel.waitForFunction(expected => document.querySelector("#page-url").title === expected, url)
  await panel.getByRole("button", { name: "Send 2 notes", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Sent 2 notes to Cross-page target" }).waitFor()
  assert.equal(crossSent.length, 1)
  assert.equal((crossSent[0].text.match(/^## Annotate review fixture$/gm) || []).length, 2)
  assert.ok(crossSent[0].text.includes(`URL: ${url}\n`))
  assert.ok(crossSent[0].text.includes(`URL: ${url}/second\n`))
  assert.ok(crossSent[0].text.includes("### Annotation 2 (comment)"))
  assert.equal(await panel.locator("#notes .note").count(), 0)
  await panel.getByRole("button", { name: "Restore last round", exact: true }).click()
  await panel.locator("#count").filter({ hasText: "2 notes in this round · 2 pages" }).waitFor()
  assert.equal(await panel.locator(".page-group").count(), 2)
  const existingPageEvent = context.waitForEvent("page")
  const existingPageTab = await panel.evaluate(url => chrome.tabs.create({ url, active: false }), `${url}/second`)
  const existingPage = await existingPageEvent
  await existingPage.waitForLoadState()
  const originalTabID = (await panel.evaluate(() => chrome.runtime.sendMessage({ action: "current" }))).tabID
  await panel.evaluate(id => chrome.tabs.update(id, { active: true }), existingPageTab.id)
  const existingTargets = await cdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }, { exclude: true }] })
  await cdp.send("Extensions.triggerAction", { id: installation.extensionID, targetId: existingTargets.targetInfos.find(tab => tab.url === `${url}/second`).targetId })
  await panel.waitForFunction(async id => !!(await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`]?.page, existingPageTab.id)
  await panel.evaluate(id => chrome.tabs.update(id, { active: true }), originalTabID)
  await panel.waitForFunction(expected => document.querySelector("#page-url").title === expected, url)
  const tabCount = context.pages().length
  await panel.getByRole("button", { name: "Edit note 2", exact: true }).click()
  await panel.locator("#composer-title").filter({ hasText: "Edit note" }).waitFor()
  await panel.getByLabel("Your feedback").fill("Page B edited from page A")
  await panel.getByRole("button", { name: "Save changes", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Saved locally" }).waitFor()
  const editedState = await panel.evaluate(() => chrome.runtime.sendMessage({ action: "current" }))
  assert.equal(editedState.tabID, existingPageTab.id)
  assert.equal(context.pages().length, tabCount)
  assert.equal(editedState.notes[1].page.url, `${url}/second`)
  assert.equal(editedState.notes[1].comment, "Page B edited from page A")
  passed.push("A→B round groups notes globally; off-page Delete/Undo/reveal, one two-page delivery and global restoration work")
  passed.push("Off-page Edit reuses an exact-URL tab, preserves page ownership and saves its comment")
  await panel.getByRole("button", { name: "Show note 1 on page", exact: true }).click()
  await panel.waitForFunction(expected => document.querySelector("#page-url").title === expected, url)
  await pick("#public")
  await panel.getByLabel("Your feedback").fill("Page A later feedback")
  await panel.getByRole("button", { name: "Add note", exact: true }).click()
  await panel.locator("#count").filter({ hasText: "3 notes in this round · 2 pages" }).waitFor()
  assert.deepEqual(await panel.locator(".note-number").allTextContents(), ["1", "2", "3"])
  const interleaved = await panel.evaluate(() => chrome.runtime.sendMessage({ action: "current" }))
  assert.deepEqual(interleaved.notes.map(note => note.comment), ["Page A feedback", "Page A later feedback", "Page B edited from page A"])
  assert.deepEqual(interleaved.anchorStates, ["located", "located", "elsewhere"])
  const interleavedMarkdown = await panel.locator("#preview").textContent()
  assert.deepEqual([...interleavedMarkdown.matchAll(/^### Annotation (\d+)/gm)].map(match => Number(match[1])), [1, 2, 3])
  assert.ok(interleavedMarkdown.indexOf("Page A later feedback") < interleavedMarkdown.indexOf("Page B edited from page A"))
  passed.push("Interleaved A→B→A notes use contiguous page-group numbering in worker state, panel and Markdown")
  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      globalThis.__opencodeAnnotate?.dispose()
      const attach = Element.prototype.attachShadow
      Element.prototype.attachShadow = function(options) {
        const root = attach.call(this, options)
        if (this.hasAttribute("data-opencode-annotate")) globalThis.__clearTestRoot = root
        return root
      }
    } })
    await chrome.scripting.executeScript({ target: { tabId }, files: ["capture.js"] })
  }, interleaved.tabID)
  const clearPins = () => worker.evaluate(async tabId => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: () => [...(globalThis.__clearTestRoot?.querySelectorAll(".pin") || [])].map(node => node.textContent) })
    return result.result
  }, interleaved.tabID)
  await panel.evaluate(() => chrome.runtime.sendMessage({ action: "markers" }))
  assert.deepEqual(await clearPins(), ["1", "2"])
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-clear.png") })
  await panel.locator(".page-group").first().getByRole("button", { name: /^Clear notes from/ }).click()
  await panel.locator("#count").filter({ hasText: "1 note in this round" }).waitFor()
  assert.deepEqual(await clearPins(), [])
  assert.deepEqual((await panel.evaluate(() => chrome.runtime.sendMessage({ action: "current" }))).notes.map(note => note.page.url), [`${url}/second`])
  await panel.locator("#undo").click()
  await panel.locator("#count").filter({ hasText: "3 notes in this round" }).waitFor()
  assert.deepEqual(await panel.locator(".note-number").allTextContents(), ["1", "2", "3"])
  assert.deepEqual(await clearPins(), ["1", "2"])
  // A stale batch fails atomically, including when an earlier reference is valid.
  const conflict = await panel.evaluate(async () => {
    const { notes } = await chrome.runtime.sendMessage({ action: "current" })
    return chrome.runtime.sendMessage({ action: "clear", notes: notes.map((note, i) => ({ url: note.page.url, id: note.id, revision: note.revision - (i === 1 ? 1 : 0) })) })
  })
  assert.equal(conflict.code, "note-conflict")
  assert.equal((await panel.evaluate(() => chrome.runtime.sendMessage({ action: "current" }))).notes.length, 3)
  await panel.locator("#clear").click()
  await panel.locator("#empty-state").waitFor()
  assert.equal(await panel.locator("#notes .note").count(), 0)
  assert.deepEqual(await clearPins(), [])
  await panel.locator("#undo").click()
  await panel.locator("#count").filter({ hasText: "3 notes in this round" }).waitFor()
  assert.deepEqual(await panel.locator(".note-number").allTextContents(), ["1", "2", "3"])
  const restoredClear = await panel.evaluate(() => chrome.runtime.sendMessage({ action: "current" }))
  assert.deepEqual(restoredClear.notes.map(note => note.id), interleaved.notes.map(note => note.id))
  // A retry snapshot is discarded only after inline confirmation; drafts survive.
  await worker.evaluate(async notes => chrome.storage.local.set({ outbox: { batchID: "clear-retry", targetID: "isolated", review: { version: 2, annotations: notes } } }), restoredClear.notes)
  await panel.locator("#send-label").filter({ hasText: "Retry 3 notes" }).waitFor()
  await panel.locator("#clear").click()
  await panel.locator("#clear-warning").waitFor()
  assert.equal((await worker.evaluate(() => chrome.storage.local.get("outbox"))).outbox.batchID, "clear-retry")
  await panel.locator("#confirm-clear").click()
  await panel.locator("#empty-state").waitFor()
  assert.equal((await worker.evaluate(() => chrome.storage.local.get("outbox"))).outbox, null)
  await panel.locator("#undo").click()
  await panel.locator("#count").filter({ hasText: "3 notes in this round" }).waitFor()
  passed.push("Page and whole-round Clear are atomic, undo restores every note with numbering intact, and retry discard requires inline confirmation")
  await pick("#public")
  await panel.getByLabel("Your feedback").fill("Keep this current-page draft during Clear")
  await panel.locator("#draft-state").filter({ hasText: "Draft saved locally" }).waitFor()
  await panel.locator("#clear").click()
  await panel.waitForFunction(() => document.querySelectorAll("#notes .note").length === 0)
  assert.equal(await panel.getByLabel("Your feedback").inputValue(), "Keep this current-page draft during Clear")
  await panel.locator("#undo").click()
  await panel.locator("#count").filter({ hasText: "3 notes in this round" }).waitFor()
  await panel.getByRole("button", { name: "Discard draft", exact: true }).click()
  // Delivered history must remain recoverable after clearing the next working round.
  await panel.evaluate(async () => {
    const { notes } = await chrome.runtime.sendMessage({ action: "current" })
    await chrome.runtime.sendMessage({ action: "copied", notes })
  })
  await panel.locator("#restore-round").waitFor()
  await pick("#public")
  await panel.getByLabel("Your feedback").fill("Temporary next-round note")
  await panel.getByRole("button", { name: "Add note", exact: true }).click()
  await panel.locator("#clear").click()
  await panel.locator("#restore-round").click()
  await panel.locator("#count").filter({ hasText: "3 notes in this round" }).waitFor()
  passed.push("Clear preserves current-page drafts and delivered rounds remain restorable")
  // Frame regression suite uses only this isolated profile. Capture closed shadow
  // roots in the extension's isolated world to assert the actual highlight/pins.
  const rpc = message => panel.evaluate(message => chrome.runtime.sendMessage(message), message)
  await worker.evaluate(async () => {
    const keys = Object.keys(await chrome.storage.local.get(null)).filter(key => /^(note:|draft:|outbox$)/.test(key))
    await chrome.storage.local.remove(keys)
  })
  const instrumentFrames = async () => {
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => {
        globalThis.__opencodeAnnotate?.dispose()
        if (!globalThis.__testAttachShadow) {
          globalThis.__testAttachShadow = Element.prototype.attachShadow
          Element.prototype.attachShadow = function(options) { const root = globalThis.__testAttachShadow.call(this, options); if (this.hasAttribute("data-opencode-annotate")) globalThis.__testRoot = root; return root }
        }
      } })
    })
    assert.equal((await rpc({ action: "current" })).ok, true)
  }
  const frameVisuals = () => worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    return chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => ({
      url: location.href, boxes: [...(globalThis.__testRoot?.querySelectorAll(".box") || [])].map(node => node.style.cssText),
      pins: [...(globalThis.__testRoot?.querySelectorAll(".pin") || [])].map(node => node.textContent),
    }) })
  })
  const frameNoteIDs = []
  for (const [fixture, selector, depth] of [["iframe", "#child", 1], ["legacy", "#right", 1], ["nested", "#outer", 2]]) {
    const fixtureURL = new URL(`/frames/${fixture}`, url).href
    await page.goto(fixtureURL); await page.bringToFront(); await activate()
    await instrumentFrames()
    if (fixture === "iframe") {
      await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
        await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => {
          const previous = globalThis.__opencodeAnnotate, dispose = previous.dispose
          delete previous.version
          previous.dispose = () => { globalThis.__testReplaced = true; dispose() }
        } })
      })
      await rpc({ action: "current" })
      const upgraded = await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
        return chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => globalThis.__testReplaced && globalThis.__opencodeAnnotate.version === 7 })
      })
      assert.ok(upgraded.every(item => item.result))
      passed.push("Pre-frame page tools are replaced once; subsequent injections preserve the current inspector")
    }
    let inner = await page.locator(selector).contentFrame()
    if (depth === 2) inner = inner.locator("#child").contentFrame()
    await rpc({ action: "pick" })
    await inner.locator("#inside").hover()
    const visuals = await frameVisuals()
    const innerBoxes = visuals.filter(item => item.result.url.includes("/frames/inner")).flatMap(item => item.result.boxes)
    assert.ok(innerBoxes.some(style => style.includes("width:")), JSON.stringify(visuals))
    assert.ok(visuals.filter(item => !item.result.url.includes("/frames/inner")).every(item => !item.result.boxes.some(style => style.includes("width:"))), "outer frames must not highlight frame elements")
    await inner.locator("#inside").click()
    await panel.waitForFunction(async () => (await chrome.runtime.sendMessage({ action: "current" })).anchor?.selector === "#inside")
    let captured = await rpc({ action: "current" })
    assert.equal(captured.page.url, fixtureURL)
    assert.equal(JSON.parse(captured.anchor.frame).selectors.length, depth)
    assert.equal(captured.picking, false)
    if (fixture === "iframe") {
      await panel.getByLabel("Your feedback").fill("Keep this frame draft")
      await panel.locator("#draft-state").filter({ hasText: "Draft saved locally" }).waitFor()
      await panel.reload()
      await panel.waitForFunction(() => document.querySelector("#comment").value === "Keep this frame draft")
      const restored = await rpc({ action: "current" })
      assert.equal(restored.draft.value.anchor.frame, captured.anchor.frame)
      assert.equal(restored.draftAnchorState, "located")
      await panel.getByRole("button", { name: "Discard draft", exact: true }).click()
    }
    const saveCapture = async (anchor, suffix) => {
      const note = { id: `frame-${fixture}-${suffix}`, page: captured.page, anchor, revision: 1, kind: "comment", comment: `Review ${fixture} ${suffix}`, createdAt: new Date().toISOString() }
      const result = await rpc({ action: "save", note, baseRevision: 0 })
      assert.equal(result.ok, true, JSON.stringify(result)); frameNoteIDs.push(note.id)
    }
    await saveCapture(captured.anchor, "element")
    await inner.locator("#inside").evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event("pointerup")) })
    await panel.waitForFunction(async () => (await chrome.runtime.sendMessage({ action: "current" })).anchor?.type === "text")
    captured = await rpc({ action: "current" })
    await saveCapture(captured.anchor, "text")
    await page.reload(); await instrumentFrames()
    const reloaded = await rpc({ action: "current" })
    assert.ok(reloaded.anchorStates.slice(-2).every(state => state === "located"), JSON.stringify(reloaded.anchorStates))
    assert.equal((await rpc({ action: "reveal", noteID: frameNoteIDs.at(-1) })).ok, true)
    assert.equal((await rpc({ action: "markers" })).ok, true)
    const markers = await frameVisuals()
    const innerPins = markers.filter(item => item.result.url.includes("/frames/inner")).flatMap(item => item.result.pins)
    assert.deepEqual(innerPins, [String(frameNoteIDs.length - 1), String(frameNoteIDs.length)])
    assert.ok(markers.filter(item => !item.result.url.includes("/frames/inner")).every(item => item.result.pins.length === 0))
    passed.push(`${fixture}: inner hover, element/text notes, top-page ownership, reload-safe reveal and globally numbered frame markers`)
  }
  // A late-loading/navigating child inherits the active picker without a new grant.
  await rpc({ action: "pick" })
  await page.locator("#outer").evaluate(node => { node.src = "/frames/inner?late" })
  const late = page.frameLocator("#outer").locator("#inside")
  await late.waitFor(); await late.hover()
  await panel.waitForFunction(async () => (await chrome.runtime.sendMessage({ action: "current" })).picking)
  await late.press("Escape")
  await panel.waitForFunction(async () => !(await chrome.runtime.sendMessage({ action: "current" })).picking)
  assert.deepEqual((await rpc({ action: "current" })).anchorStates.slice(-2), ["missing frame", "missing frame"])
  const navigatedReveal = await rpc({ action: "reveal", noteID: frameNoteIDs.at(-1) })
  assert.equal(navigatedReveal.ok, false)
  assert.match(navigatedReveal.error, /frame is missing or has navigated/)
  passed.push("A navigating child inherits picking, and Escape in that child cancels every frame")
  await page.locator("#outer").evaluate(node => { node.srcdoc = '<p id="blank-child">Inherited origin text</p>' })
  const inherited = page.frameLocator("#outer").locator("#blank-child")
  await inherited.waitFor()
  await rpc({ action: "pick" })
  await inherited.click()
  await panel.waitForFunction(async () => (await chrome.runtime.sendMessage({ action: "current" })).anchor?.selector === "#blank-child")
  assert.equal(JSON.parse((await rpc({ action: "current" })).anchor.frame).url, "about:srcdoc")
  passed.push("Inherited-origin srcdoc frames remain accessible and retain a stable frame locator")
  await page.goto(new URL("/frames/foreign", url).href); await activate(); await instrumentFrames()
  await rpc({ action: "pick" })
  await page.locator("#foreign").hover({ position: { x: 1, y: 1 } })
  await panel.waitForFunction(async () => (await chrome.runtime.sendMessage({ action: "current" })).error === "This frame is from another site; Annotate can't read it")
  await panel.locator("#page-error").filter({ hasText: "This frame is from another site; Annotate can't read it" }).waitFor()
  assert.ok((await frameVisuals()).filter(item => item.frameId === 0).every(item => item.result.boxes.length === 0))
  await rpc({ action: "pick" })
  passed.push("An inaccessible cross-origin frame shows a specific explanation instead of a whole-frame highlight")
  const frameDeliveries = []
  const frameReceiver = await createReceiver({ root: targetsDirectory, sessionID: "ses_frames", title: "Frame tests", directory: "/isolated-test", resume: false,
    client: { session: { get: async () => ({}), prompt: async input => { frameDeliveries.push(input); return { id: input.id } } } } })
  additionalReceivers.push(frameReceiver)
  assert.equal((await rpc({ action: "pair", target: frameReceiver.target })).ok, true)
  assert.equal((await rpc({ action: "send", targetID: frameReceiver.target.id })).ok, true)
  assert.equal((frameDeliveries[0].text.match(/^Frame: /gm) || []).length, 6)
  const frameRound = await rpc({ action: "current" })
  await rpc({ action: "restore-round", roundID: frameRound.lastRound.id })
  await panel.reload()
  await panel.evaluate(() => { navigator.clipboard.writeText = async text => { window.frameCopy = text } })
  await panel.waitForFunction(() => document.querySelectorAll("#notes .note").length === 6)
  await panel.getByRole("button", { name: "More review options", exact: true }).click()
  await panel.getByRole("button", { name: "Copy Markdown", exact: true }).click()
  await panel.waitForFunction(() => !!window.frameCopy)
  assert.equal(((await panel.evaluate(() => window.frameCopy)).match(/^Frame: /gm) || []).length, 6)
  passed.push("Native Send and Copy Markdown both preserve all frame locator lines across a multi-page round")
  await panel.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime)
    chrome.runtime.sendMessage = async message => {
      const result = await send(message)
      if (message.action === "current") return { ...result, protocol: undefined }
      return message.action === "copied" ? { ok: false, error: "Unknown annotation action" } : result
    }
  })
  await panel.locator("#update-notice").waitFor()
  assert.equal(await panel.getByRole("button", { name: "Reload Annotate", exact: true }).isEnabled(), true)
  assert.equal(await panel.locator("#send").isDisabled(), true)
  assert.equal(await panel.locator("#status").evaluate(node => node.classList.contains("error")), false)
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-outdated.png") })
  passed.push("An outdated background worker shows a one-click reload instead of raw action errors")
  assert.deepEqual(errors, [])
  await writeFile(path.join(artifacts, "results.json"), JSON.stringify({ passed, errors }, null, 2))
  console.log(JSON.stringify({ passed }, null, 2))
} catch (error) {
  if (panel) console.error(JSON.stringify({ passed, ui: await panel.locator("body").innerText(), state: await panel.evaluate(() => chrome.runtime.sendMessage({ action: "current" })) }, null, 2))
  throw error
} finally {
  await context?.close(); await receiver?.close(); await Promise.all(additionalReceivers.map(receiver => receiver.close())); await new Promise(resolve => server.close(resolve)); await new Promise(resolve => foreignServer.close(resolve)); await rm(temp, { recursive: true, force: true })
}
