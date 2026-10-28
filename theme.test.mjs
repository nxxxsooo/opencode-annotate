import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { prepareTheme, themeColors } from "./theme.mjs"
import { resolveTuiBinary } from "./tui/binary.mjs"

const rgba = (r, g, b, a = 1) => ({ r: r / 255, g: g / 255, b: b / 255, a })
function theme() {
  const text = rgba(248, 248, 242), bg = rgba(40, 42, 54), accent = rgba(189, 147, 249)
  return {
    text: { base: text, muted: rgba(98, 114, 164), action: { primary: { selected: accent, focused: bg } },
      feedback: { warning: { base: rgba(241, 250, 140) }, success: { base: rgba(80, 250, 123) }, error: { base: rgba(255, 85, 85) } } },
    background: { base: bg, raised: { base: rgba(33, 34, 44), high: rgba(68, 71, 90) },
      action: { primary: { base: rgba(98, 114, 164), focused: accent } },
      feedback: { success: { base: rgba(80, 250, 123) }, warning: { base: rgba(241, 250, 140) } } },
    border: { base: rgba(68, 71, 90) },
    markdown: { heading: accent, code: rgba(80, 250, 123), link: rgba(139, 233, 253), blockQuote: rgba(98, 114, 164),
      strong: rgba(255, 184, 108), emphasis: rgba(241, 250, 140), listItem: rgba(139, 233, 253),
      linkText: rgba(255, 121, 198), listEnumeration: rgba(80, 250, 123), horizontalRule: rgba(68, 71, 90) },
    diff: { background: { added: rgba(26, 58, 26) } },
  }
}

test("resolved RGBA colors preserve host foregrounds, contrast pairs and alpha", () => {
  const host = theme()
  host.border.base = rgba(200, 100, 50, 0.5)
  const colors = themeColors(host)
  assert.equal(colors.background, "#282a36")
  assert.equal(colors.foreground, "#f8f8f2")
  assert.equal(colors.selection, "#bd93f9")
  assert.equal(colors["selection-fg"], "#282a36")
  assert.equal(colors.border, "#784734")
  assert.equal(colors.strong, "#ffb86c")
  assert.equal(colors["list-number"], colors["list-item"])
  assert.equal(colors["link-text"], "#ff79c6")
  // Dark page text stays legible on the pale success and warning buttons.
  assert.equal(colors["send-fg"], "#282a36")
  host.border.base = rgba(0, 0, 0, 0)
  assert.equal(themeColors(host).border, "reset")
  host.markdown.heading = undefined
  assert.throws(() => themeColors(host), /markdown.heading/)
})

test("light selections use a legible foreground from the host palette", () => {
  const host = theme()
  host.background.base = rgba(248, 248, 242)
  host.text.base = rgba(40, 42, 54)
  host.text.action.primary.focused = host.background.base
  const colors = themeColors(host)
  assert.equal(colors.selection, "#bd93f9")
  assert.equal(colors["selection-fg"], "#282a36")
  assert.equal(colors["cursor-fg"], "#282a36")
})

const binary = resolveTuiBinary(process.env.ANNOTATE_THEME_BINARY)
test("bundled reviewer validates an isolated palette while preserving layout and the user's config", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "annotate-theme-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = path.join(directory, "user.toml")
  const original = '# User comment\n[ui]\nhorizontal_margin = 4\nmax_width = 120\n[colors]\nheading = "red"\n'
  await writeFile(source, original)
  const env = { ...process.env, PLANNOTATOR_TUI_CONFIG: source, PLANNOTATOR_TUI_THEME: "light" }
  const result = await prepareTheme({ binary, directory, theme: theme(), env })
  assert.notEqual(result.PLANNOTATOR_TUI_CONFIG, source)
  assert.equal(await readFile(source, "utf8"), original)
  assert.equal((await stat(result.PLANNOTATOR_TUI_CONFIG)).mode & 0o777, 0o600)
  const effective = execFileSync(binary, ["config"], { env: result, encoding: "utf8" })
  assert.match(effective, /horizontal_margin = 4/)
  assert.match(effective, /max_width = 120/)
  assert.match(effective, /theme = "light"/)
  assert.match(effective, /heading = "#BD93F9"/i)
  const second = theme()
  second.background.base = rgba(255, 255, 255)
  const changed = await prepareTheme({ binary, directory, theme: second, env })
  assert.match(await readFile(changed.PLANNOTATOR_TUI_CONFIG, "utf8"), /background = "#ffffff"/)
})
