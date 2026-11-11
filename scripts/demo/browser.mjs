// Run from the repository root; uses only the extracted 0.13.0 package and an isolated profile.
import { createServer } from "node:http"
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import assert from "node:assert/strict"
import { installBridge } from "../../.local/demo-release/package/scripts/install-bridge.mjs"
import { createReceiver } from "../../.local/demo-release/package/bridge/receiver.mjs"

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core")
const temp = await mkdtemp(path.join(os.homedir(), ".cache/oa-demo-"))
const html = await readFile(new URL("product.html", import.meta.url))
const server = createServer((_req, res) => { res.setHeader("content-type", "text/html"); res.end(html) })
let context, receiver
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const targetsDirectory = path.join(temp, "t")
  const installation = await installBridge({ profileDirectory: path.join(temp, "chrome"), installRoot: path.join(temp, "host"), targetsDirectory })
  receiver = await createReceiver({ root: targetsDirectory, sessionID: "ses_synthetic_demo", title: "Project search review", directory: "/demo/fieldnotes", resume: false,
    client: { session: { get: async () => ({}), prompt: async () => { throw new Error("Demo must never send feedback") } } } })
  context = await chromium.launchPersistentContext(path.join(temp, "chrome"), {
    executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true,
    viewport: { width: 1200, height: 800 },
    args: [`--disable-extensions-except=${installation.extensionDirectory}`, `--load-extension=${installation.extensionDirectory}`, "--enable-unsafe-extension-debugging"],
  })
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker")
  await worker.evaluate(async () => {
    const deadline = Date.now() + 5000
    while (!chrome.action.onClicked.hasListeners()) {
      if (Date.now() > deadline) throw new Error("Extension did not initialize")
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  })
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/projects`)
  await page.bringToFront() // Isolated headless profile only.
  const cdp = await context.browser().newBrowserCDPSession()
  const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }, { exclude: true }] })
  const target = targetInfos.find(t => t.url === page.url())
  await cdp.send("Extensions.triggerAction", { id: installation.extensionID, targetId: target.targetId })
  await page.waitForSelector("[data-opencode-annotate]", { state: "attached" })
  const opened = context.waitForEvent("page", { predicate: p => p.url().includes("panel.html") })
  await worker.evaluate(() => chrome.tabs.create({ url: chrome.runtime.getURL("panel.html"), active: false }))
  const panel = await opened
  await panel.setViewportSize({ width: 440, height: 740 })
  await panel.locator("#page-title").filter({ hasText: "Project search · Fieldnotes" }).waitFor()
  await panel.locator("#paired").filter({ hasText: "Project search review" }).waitFor()
  await panel.getByRole("button", { name: "Pick element", exact: true }).click()
  await panel.getByRole("button", { name: "Cancel pick (Esc)", exact: true }).waitFor()
  await page.locator("#empty").click()
  await panel.locator("#quote").filter({ hasText: "No projects match your search." }).waitFor()
  await panel.getByLabel("Your feedback").fill("Add a Clear search action so people can recover without retyping.")
  await panel.getByRole("button", { name: "Add note", exact: true }).click()
  await panel.locator("#count").filter({ hasText: "1 note" }).waitFor()
  assert.match(await panel.locator("#notes").innerText(), /Clear search/)
  assert.equal(await panel.locator("#send").isEnabled(), true)
  assert.match(await panel.locator("#send-label").innerText(), /Send/)
  await mkdir("docs/assets", { recursive: true })
  await panel.screenshot({ path: "docs/assets/browser-review.png" })
  console.log("Captured published 0.13.0 extension: 1 saved synthetic note; no send invoked.")
} finally {
  await context?.close()
  await receiver?.close()
  await new Promise(resolve => server.close(resolve))
  await rm(temp, { recursive: true, force: true })
}
