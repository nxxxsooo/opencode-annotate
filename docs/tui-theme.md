# Inherited TUI colors

The development option `inheritTheme: true` uses the current OpenCode `context.theme`
on each invocation. It requires the extended Plannotator fork
(`nxxxsooo/plannotator-tui`, branch `feat/opencode-theme`, or `feat/layout` for the
document-width setting), based on the `[colors]` work in upstream PR #105 plus the
local viewport patch. Upstream Plannotator 0.9.4 does not support it.

```json
{
  "package": "/absolute/path/to/opencode-annotate",
  "options": {
    "binary": "/absolute/path/to/plannotator-tui-annotate",
    "inheritTheme": true
  }
}
```

## Configuration contract

1. Run the configured binary's `config` command with the review's light/dark mode.
2. Use its canonical TOML (strict schema, `[colors]` serialized last), preserving
   `[ui]` and `[herdr]`, and replace the palette in a private `theme.toml`.
3. Set `PLANNOTATOR_TUI_CONFIG` to that copy and run `config` again. Every mapped
   role must round-trip before the terminal is suspended. An old binary or a launcher
   that ignores the override produces an actionable error.
4. Use the same environment for interactive review and export. The temporary config
   follows the review's cleanup/recovery lifecycle and is never written over the user file.

A scoped launcher must use `${PLANNOTATOR_TUI_CONFIG:-<default-config>}` so the
plugin's per-review copy takes precedence. Without `inheritTheme`, the existing
light/dark integration continues to work with the upstream release.

## Mapping

- Canvas/text/muted/border: `background.base`, `text.base`, `text.muted`, `border.base`.
- Accent: `text.action.primary.selected`; headings/code/links/quotes: their Markdown tokens.
- Bold, italic, list markers and rules: `markdown.strong`, `markdown.emphasis`,
  `markdown.listItem` (bullets and numbers alike, as OpenTUI renders them),
  `markdown.horizontalRule`. Table headers use the heading color.
- Link labels: `markdown.linkText`; destinations keep `markdown.link`. OpenCode hides
  destinations when the terminal supports clickable links; the reviewer still shows them.
- Send button: the focused primary-action background (the accent); sent/blocked: the
  success/warning feedback text colors, because themes often leave those backgrounds
  transparent. Its label is the host's page or body color, whichever stays most legible.
- Comment/approval/deletion: warning/success/error text tokens.
- Focused block: raised base; toolbar/comment highlight: raised high; approval highlight:
  the added-diff background.
- Cursor and selection: the focused primary-action background **and foreground**.
  When that pair is below 4.5:1 contrast, use the host's body foreground if it provides
  better contrast (notably Dracula light); no colors outside the host palette are introduced.

Font family and size come from the terminal, which already draws both OpenCode and the
reviewer; only weight and color are set per span.

RGBA channels are resolved by OpenCode. Transparent tokens use terminal reset;
partial opacity is composited onto an opaque base. A partial-alpha token over a
transparent base is rejected because its actual terminal backdrop is unavailable.
The fork fills unset cell colors after drawing, including cleared popups and margins.

## Verification

```sh
ANNOTATE_THEME_BINARY=/path/to/fork/plannotator-tui npm run check
ANNOTATE_TUI_BINARY=/path/to/launcher ANNOTATE_INHERIT_THEME=1 \
  ANNOTATE_THEME_MODE=dark ANNOTATE_EXPECT_MARGIN=2 npm run test:smoke
ANNOTATE_TUI_BINARY=/path/to/launcher ANNOTATE_INHERIT_THEME=1 \
  ANNOTATE_THEME_MODE=light ANNOTATE_EXPECT_MARGIN=2 npm run test:smoke
```

The smoke test compares captured ANSI colors to the real host's resolved tokens and
exercises annotation creation, terminal restoration, confirmation and exact-session
delivery with `resume: false`. No model turn is started. `ANNOTATE_EXPECT_MARGIN` is the
blank margin expected in the 140-column test pane: `[ui].horizontal_margin` while
`max_width` exceeds the pane. `ANNOTATE_SEND_KEY=1` adds the fork's one-step `Ctrl+S`
send (branch `feat/send-intent`) and asserts that no OpenCode confirmation appears.

## Layout

The scoped `annotate.toml` sets `horizontal_margin = 2`, `max_width = 168` and
`doc_width = 120`. `doc_width` (fork branch `feat/layout`) caps the document's text
columns, so wide terminals keep a readable column beside a 42-column comment rail.
Font family and size stay with the terminal.
