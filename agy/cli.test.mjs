import { test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import os from "node:os"
import { mkdir, rm } from "node:fs/promises"
import { resolveAdaptedBinary, getAdaptedThemeTokens } from "./cli.mjs"
import { prepareTheme } from "../theme.mjs"

test("resolveAdaptedBinary honors custom binary or finds local annotate fork", () => {
  const custom = "/custom/bin/plannotator-tui"
  assert.equal(resolveAdaptedBinary(custom), custom)

  const resolved = resolveAdaptedBinary()
  // On this system, ~/.local/bin/plannotator-tui-annotate exists
  assert.match(resolved, /(plannotator-tui-annotate|plannotator-tui)$/)
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

test("prepareTheme succeeds with getAdaptedThemeTokens and adapted binary", async () => {
  const binary = resolveAdaptedBinary()
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
