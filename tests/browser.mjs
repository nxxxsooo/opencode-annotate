import { createServer } from "node:http"
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import os from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { installBridge } from "../scripts/install-bridge.mjs"
import { createReceiver } from "../bridge/receiver.mjs"

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || pathToFileURL(path.join(os.homedir(), ".agents/node_modules/playwright-core/index.mjs")).href)

const project = fileURLToPath(new URL("../", import.meta.url))
const artifacts = path.join(project, ".local/browser-test")
await mkdir(artifacts, { recursive: true })
const temp = await mkdtemp(path.join(os.homedir(), ".cache/oa-browser-"))
const html = `<!doctype html><html lang=en><meta charset=utf-8><title>Annotate review fixture</title><style>body{font:18px/1.8 system-ui;padding:40px;max-width:700px}button{padding:12px}p{margin:24px 0}.css-hidden{display:none}</style><h1>Review a live webpage</h1><p id=duplicate>First: same text, context A. Second: same text, context B.</p><p id=unicode>Before 😀 <b>中文选区</b> after 🚀.</p><button id=target onclick="window.clicked=(window.clicked||0)+1">Run the workflow</button><p><span contenteditable>never-export-before</span><span id=public>Public text</span><span contenteditable>never-export-after</span></p><input id=password type=password value=never-export-password><section id=dashboard><h2>月度复盘</h2><p>Track attendance</p><button id=gear aria-label=Settings><svg aria-hidden=true width=24 height=24><title>never-export-icon</title><circle cx=12 cy=12 r=10 /></svg></button><input type=hidden value=never-export-hidden><textarea hidden>never-export-textarea</textarea><span class=css-hidden>never-export-css</span><div contenteditable>never-export-editor</div></section><canvas id=canvas width=50 height=20></canvas>`
const server = createServer((_request, response) => { response.setHeader("content-type", "text/html"); response.end(html) })
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
const url = `http://127.0.0.1:${server.address().port}/fixture`
const targetsDirectory = path.join(temp, "targets")
const installation = await installBridge({ profileDirectory: path.join(temp, "chrome"), installRoot: path.join(temp, "host"), targetsDirectory })
const sent = []
const receiver = await createReceiver({ root: targetsDirectory, sessionID: "ses_browser_test", title: "Browser test target", directory: "/isolated-test", resume: false,
  client: { session: { get: async () => ({}), prompt: async input => { sent.push(input); return { id: input.id } } } } })
let context
const additionalReceivers = []
const passed = []
try {
  context = await chromium.launchPersistentContext(path.join(temp, "chrome"), {
    executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
    headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${installation.extensionDirectory}`, `--load-extension=${installation.extensionDirectory}`, "--enable-unsafe-extension-debugging"],
  })
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker")
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
  const panel = await panelEvent
  const errors = []; panel.on("pageerror", e => errors.push(e.message))
  await panel.getByRole("heading", { name: "Annotate review fixture" }).waitFor()
  await panel.locator("#paired").filter({ hasText: "Browser test target" }).waitFor()
  assert.equal(await panel.getByRole("button", { name: "Pair selected session", exact: true }).count(), 0)
  assert.equal(await panel.locator("#session-options").isVisible(), false)
  assert.equal((await worker.evaluate(() => chrome.storage.local.get("paired"))).paired, undefined)
  assert.equal(sent.length, 0)
  passed.push("A sole session is shown automatically without pairing steps or pre-send authorization")
  await panel.getByRole("button", { name: "Pick an element", exact: true }).click()
  await panel.getByRole("button", { name: "Cancel pick (Esc)", exact: true }).waitFor()
  await page.locator("#dashboard").click({ position: { x: 5, y: 5 } })
  await panel.locator("#quote").filter({ hasText: "月度复盘" }).waitFor()
  assert.ok(!(await panel.locator("#quote").textContent()).includes("never-export"))
  assert.equal(await panel.getByRole("button", { name: "Pick an element", exact: true }).getAttribute("aria-pressed"), "false")
  await panel.getByRole("button", { name: "Cancel edit", exact: true }).click()
  await panel.getByRole("button", { name: "Pick an element", exact: true }).click()
  await page.locator("#password").click()
  await panel.locator("#quote").filter({ hasText: "password control" }).waitFor()
  assert.ok(!(await panel.locator("#quote").textContent()).includes("never-export"))
  await panel.getByRole("button", { name: "Cancel edit", exact: true }).click()
  passed.push("Containers with hidden SVG/editors are annotatable; input controls exclude their values")
  await panel.getByRole("button", { name: "Pick an element", exact: true }).click()
  await page.locator("#canvas").click()
  await panel.getByRole("status").filter({ hasText: "unsupported" }).waitFor()
  assert.equal(await panel.getByRole("button", { name: "Pick an element", exact: true }).getAttribute("aria-pressed"), "false")
  await page.locator("#target").click()
  assert.equal(await page.evaluate(() => window.clicked), 1)
  await panel.getByRole("button", { name: "Pick an element", exact: true }).click()
  await page.locator("#gear svg").click()
  await panel.locator("#quote").filter({ hasText: "Settings" }).waitFor()
  assert.equal(await panel.getByRole("status").evaluate(el => el.classList.contains("error")), false)
  await panel.getByRole("button", { name: "Cancel edit", exact: true }).click()
  passed.push("Failed picks exit interception immediately and a valid pick clears the old error")
  await panel.getByRole("button", { name: "Pick an element", exact: true }).click()
  await panel.getByRole("button", { name: "Cancel pick (Esc)", exact: true }).waitFor()
  await activate()
  await panel.getByRole("button", { name: "Pick an element", exact: true }).waitFor()
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
  await select("#duplicate", "same text", 1)
  await panel.getByLabel("My feedback").fill("Explain the second occurrence, not the first.")
  await panel.getByLabel("Feedback type").selectOption("ask")
  await panel.getByRole("button", { name: "Save note", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Saved locally" }).waitFor()
  assert.ok((await panel.locator("#preview").textContent()).includes("Second: 【same text】, context B."))
  assert.equal(await page.locator("body").evaluate(el => el.textContent.includes("Explain the second occurrence")), false)
  passed.push("Exact duplicate selection, complete context, and private comment UI")

  await panel.getByRole("button", { name: "Pick an element", exact: true }).click()
  await page.locator("#target").click()
  await panel.locator("#quote").filter({ hasText: "Run the workflow" }).waitFor()
  await panel.getByLabel("My feedback").fill("Rename this button to Start.")
  await panel.getByRole("button", { name: "Save note", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Saved locally" }).waitFor()
  assert.equal(await page.evaluate(() => window.clicked), 2)
  passed.push("Element picking blocks the original action")

  await select("#public", "Public text")
  await panel.getByLabel("My feedback").fill("Adjacent editors must stay private.")
  await panel.getByRole("button", { name: "Save note", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Saved locally" }).waitFor()
  assert.ok(!(await panel.locator("#preview").textContent()).includes("never-export"))
  const downloadPromise = panel.waitForEvent("download")
  await panel.getByRole("button", { name: "Export JSON", exact: true }).click()
  const exported = JSON.parse(await readFile(await (await downloadPromise).path(), "utf8"))
  assert.equal(exported.annotations.length, 3)
  assert.ok(exported.annotations[0].anchor.styles)
  assert.equal(exported.page.url, url)
  passed.push("Complete JSON export includes styles/URL and excludes adjacent editors")

  await page.reload(); await activate(); await page.waitForSelector("[data-opencode-annotate]", { state: "attached" })
  await panel.getByText("3 notes", { exact: true }).waitFor()
  await page.evaluate(() => history.pushState({}, "", "/other"))
  await panel.getByText("0 notes", { exact: true }).waitFor()
  await page.evaluate(() => history.back())
  await panel.getByText("3 notes", { exact: true }).waitFor()
  passed.push("Reload restores drafts; SPA routes isolate and restore notes")

  await panel.getByRole("button", { name: "Send & continue", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Feedback queued" }).waitFor()
  assert.equal(sent.length, 1); assert.equal(sent[0].sessionID, "ses_browser_test"); assert.equal(sent[0].resume, false)
  assert.ok(sent[0].text.includes("Explain the second occurrence"))
  assert.equal(await panel.getByRole("button", { name: "Send & continue", exact: true }).isDisabled(), true)
  passed.push("One Send click authorizes and delivers to the displayed session through Native Messaging")

  const other = await createReceiver({ root: targetsDirectory, sessionID: "ses_other", title: "Other session", directory: "/other-test", resume: false,
    client: { session: { get: async () => ({}), prompt: async () => { throw new Error("Must not send to the other session") } } } })
  additionalReceivers.push(other)
  await panel.evaluate(() => chrome.runtime.sendMessage({ action: "unpair" }))
  await panel.getByLabel("Choose session").waitFor()
  await panel.locator("#paired").filter({ hasText: "Choose where" }).waitFor()
  assert.equal(await panel.getByRole("button", { name: "Send & continue", exact: true }).isDisabled(), true)
  await panel.getByLabel("Choose session").selectOption(receiver.target.id)
  await panel.locator("#paired").filter({ hasText: "Browser test target" }).waitFor()
  assert.equal(await panel.locator("#session-options").isVisible(), false)
  assert.equal(sent.length, 1)
  passed.push("Multiple sessions require one explicit choice, without a separate Pair confirmation")

  await panel.getByRole("button", { name: "Edit", exact: true }).first().click()
  await panel.getByLabel("My feedback").fill("Revised question after sending.")
  await panel.setViewportSize({ width: 420, height: 1000 })
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel.png"), fullPage: true })
  await panel.setViewportSize({ width: 320, height: 844 })
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-narrow.png"), fullPage: true })
  await panel.getByRole("button", { name: "Send & continue", exact: true }).click()
  await panel.getByRole("status").filter({ hasText: "Feedback queued" }).waitFor()
  assert.equal(sent.length, 2)
  assert.ok(sent[1].text.includes("Revised question")); assert.ok(!sent[1].text.includes("Rename this button"))
  const duplicateSend = await panel.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ action: "current" })
    const note = state.notes[0]
    await chrome.runtime.sendMessage({ action: "save", url: state.page.url, note, baseRevision: note.revision })
    const targetID = (await chrome.runtime.sendMessage({ action: "pairing" })).target.id
    return Promise.all([1, 2].map(() => chrome.runtime.sendMessage({ action: "send", url: state.page.url, targetID })))
  })
  assert.equal(duplicateSend.filter(result => result.ok).length, 1)
  assert.equal(sent.length, 3)
  passed.push("Simultaneous send requests cannot create duplicate batches after acknowledgement")
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
  await panel.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("denied") } })
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
  assert.equal(sent.length, 3)
  const pending = await worker.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).filter(([key]) => key.startsWith("outbox:")))
  assert.equal(pending.length, 1)
  const stale = await panel.evaluate(() => chrome.runtime.sendMessage({ action: "connection" }))
  assert.equal(stale.targets.length, 1)
  assert.equal(stale.target, null)
  assert.equal(stale.stale, true)
  passed.push("Offline paired target retains a retryable outbox without rerouting")
  await panel.emulateMedia({ colorScheme: "dark" }); await panel.setViewportSize({ width: 420, height: 1000 })
  if (!process.env.SKIP_SCREENSHOTS) await panel.screenshot({ path: path.join(artifacts, "panel-dark.png"), fullPage: true })
  assert.deepEqual(errors, [])
  passed.push("Editing sent notes creates a new pending revision; only new feedback is sent")
  await writeFile(path.join(artifacts, "results.json"), JSON.stringify({ passed, errors }, null, 2))
  console.log(JSON.stringify({ passed }, null, 2))
} finally {
  await context?.close(); await receiver.close(); await Promise.all(additionalReceivers.map(receiver => receiver.close())); await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true })
}
