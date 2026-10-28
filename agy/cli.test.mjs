import { test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import os from "node:os"
import { mkdir, rm } from "node:fs/promises"
import { getAdaptedThemeTokens } from "./cli.mjs"
import { bundledBinary, resolveTuiBinary } from "../tui/binary.mjs"
import { prepareTheme } from "../theme.mjs"

test("both adapters resolve the packaged reviewer or an explicit custom binary", () => {
  const custom = "/custom/bin/annotate-tui"
  assert.equal(resolveTuiBinary(custom), custom)
  assert.equal(resolveTuiBinary(), bundledBinary())
})

test("getAdaptedThemeTokens returns valid RGBA palette tokens", () => {
  const tokens = getAdaptedThemeTokens()
  assert.ok(tokens.text.base)
  assert.ok(tokens.background.base)
  assert.ok(tokens.markdown.heading)
  assert.equal(typeof tokens.text.base.r, "number")
  assert.equal(typeof tokens.text.base.g, "number")
  assert.equal(typeof tokens.text.base.b, "number")
  assert.equal(typeof tokens.text.base.a, "number")
})

test("AGY theme tokens work with the bundled reviewer", async () => {
  const binary = resolveTuiBinary()
  const tempDir = path.join(os.tmpdir(), `agy-cli-test-${Date.now()}`)
  await mkdir(tempDir, { recursive: true })
  try {
    const env = await prepareTheme({
      binary,
      theme: getAdaptedThemeTokens(),
      directory: tempDir,
      env: process.env,
    })
    assert.ok(env.PLANNOTATOR_TUI_CONFIG)
    assert.ok(env.PLANNOTATOR_TUI_CONFIG.endsWith("theme.toml"))
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
