import { execFile } from "node:child_process"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execute = promisify(execFile)

export function themeColors(theme) {
  const roles = {
    foreground: "text.base",
    background: "background.base",
    muted: "text.muted",
    border: "border.base",
    accent: "text.action.primary.selected",
    heading: "markdown.heading",
    code: "markdown.code",
    link: "markdown.link",
    "link-text": "markdown.linkText",
    quote: "markdown.blockQuote",
    strong: "markdown.strong",
    emphasis: "markdown.emphasis",
    "list-item": "markdown.listItem",
    // OpenTUI styles ordered and unordered markers alike with markup.list.
    "list-number": "markdown.listItem",
    rule: "markdown.horizontalRule",
    // Many themes leave action and feedback backgrounds transparent or equal to the
    // page, so the send button uses the visible accent and feedback text colors.
    send: "background.action.primary.focused",
    sent: "text.feedback.success.base",
    blocked: "text.feedback.warning.base",
    comment: "text.feedback.warning.base",
    "looks-good": "text.feedback.success.base",
    delete: "text.feedback.error.base",
    "comment-bg": "background.raised.high",
    "looks-good-bg": "diff.background.added",
    block: "background.raised.base",
    toolbar: "background.raised.high",
    cursor: "background.action.primary.focused",
    "cursor-fg": "text.action.primary.focused",
    selection: "background.action.primary.focused",
    "selection-fg": "text.action.primary.focused",
  }
  const token = name => {
    const color = name.split(".").reduce((value, key) => value?.[key], theme)
    if (!color || [color.r, color.g, color.b, color.a].some(value =>
      !Number.isFinite(value) || value < 0 || value > 1,
    )) throw new Error(`OpenCode theme token ${name} is not a resolved RGBA color.`)
    return color
  }
  const base = token("background.base")
  const colors = Object.fromEntries(Object.entries(roles).map(([role, name]) => {
    const color = token(name)
    if (color.a === 0) return [role, "reset"]
    if (color.a < 1 && base.a !== 1) {
      throw new Error(`Can't resolve translucent theme token ${name} over a transparent terminal.`)
    }
    const hex = ["r", "g", "b"].map(channel =>
      Math.round(255 * (color[channel] * color.a + base[channel] * (1 - color.a)))
        .toString(16).padStart(2, "0"),
    ).join("")
    return [role, `#${hex}`]
  }))
  const luminance = color => color.slice(1).match(/../g).map(value => {
    const channel = Number.parseInt(value, 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  const contrast = (one, two) => {
    const [a, b] = [luminance(one), luminance(two)].sort((x, y) => x - y)
    return (b + 0.05) / (a + 0.05)
  }
  const hex = (...items) => items.every(color => color.startsWith("#"))
  // Some host themes use a pale focused label even on a pale accent. Keep their
  // palette, but use the body foreground when it makes selected text more legible.
  if (hex(colors.selection, colors["selection-fg"], colors.foreground)) {
    const focused = contrast(colors.selection, colors["selection-fg"])
    if (focused < 4.5 && contrast(colors.selection, colors.foreground) > focused) {
      colors["selection-fg"] = colors.foreground
      colors["cursor-fg"] = colors.foreground
    }
  }
  // One label colour serves the send, sent and blocked buttons: take whichever of
  // the host's page or body colour stays most legible on all three.
  const buttons = [colors.send, colors.sent, colors.blocked]
  const labels = [colors.background, colors.foreground].filter(color => color.startsWith("#"))
  if (hex(...buttons) && labels.length) {
    colors["send-fg"] = labels.reduce((best, color) =>
      Math.min(...buttons.map(button => contrast(button, color)))
        > Math.min(...buttons.map(button => contrast(button, best))) ? color : best)
  }
  return colors
}

export async function prepareTheme({ binary, theme, directory, env, signal }) {
  const colors = themeColors(theme)
  const config = async environment => execute(binary, ["config"], {
    cwd: directory, env: environment, signal, timeout: 15000, maxBuffer: 1024 * 1024,
  })
  const { stdout } = await config(env)
  // The reviewer's `config` command serializes its strict schema with [colors] last.
  // Work on that normalized output, never try to parse or rewrite the user's TOML.
  const marker = stdout.lastIndexOf("\n[colors]\n")
  if (marker < 0) throw new Error("Annotate TUI did not return its color configuration. Check the plugin's binary option.")
  const filename = path.join(directory, "theme.toml")
  const palette = Object.entries(colors).map(([role, value]) => `${role} = "${value}"`).join("\n")
  await writeFile(filename, `${stdout.slice(0, marker)}\n\n[colors]\n${palette}\n`, { mode: 0o600 })
  const themed = { ...env, PLANNOTATOR_TUI_CONFIG: filename }
  const effective = await config(themed)
  // Also catches launchers that overwrite PLANNOTATOR_TUI_CONFIG instead of honoring it.
  for (const [role, value] of Object.entries(colors)) {
    if (!new RegExp(`^${role} = "${value}"$`, "mi").test(effective.stdout)) {
      throw new Error(`Annotate TUI did not apply ${role}. Its launcher must honor PLANNOTATOR_TUI_CONFIG.`)
    }
  }
  return themed
}
