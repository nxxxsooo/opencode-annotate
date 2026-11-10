import { test } from "node:test"
import assert from "node:assert/strict"
import { browserApp, CHROME_APP, SAFARI_APP } from "./browser-target.mjs"

test("browser choice defaults to Chrome and accepts Safari explicitly", () => {
  assert.equal(browserApp(), CHROME_APP)
  assert.equal(browserApp({}), CHROME_APP)
  assert.equal(browserApp({ browser: "Chrome" }), CHROME_APP)
  assert.equal(browserApp({ browser: "Safari" }), SAFARI_APP)
})
test("unknown browser is rejected rather than opening the wrong app", () => {
  for (const browser of ["Firefox", "", "Google Chrome"]) assert.throws(() => browserApp({ browser }), /browser must be/)
})
