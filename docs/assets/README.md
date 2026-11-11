# Review captures

Both assets show the published **@nxxxsooo/opencode-annotate 0.13.0** UI
(npm `gitHead` `d0f2077dedd519a00da3aca5c8de878edd47efe0`). All page text,
document text, feedback and session labels are synthetic.

- `terminal-review.gif`: the package's bundled native reviewer, recorded headlessly
  through VHS/ttyd (106 columns × 24 rows; 1120 × 500 pixels; about 8.7 seconds).
  Real keyboard selection opens the default Unicode toolbar, then
  a comment is typed and saved. No PNG toolbar artwork is loaded or distributed.
- `browser-review.png`: the package's real unpacked Chrome extension, with one saved
  note on the local `product.html` fixture (440 × 740 pixels). An isolated test receiver supplies a
  synthetic live destination; no feedback is sent and no model is called.
  The extension panel is captured as a background tab in headless Chromium, following
  the browser-test harness. This is **not** a screenshot of Chrome's native side-panel
  frame, and does not prove real sidebar/tab-switching or Safari behavior.

## Reproduce from the repository root

Requires Node 22+, VHS (with ttyd and ffmpeg), Menlo or a comparable monospace font,
Playwright Core and an installed Chromium with extension support. Use an isolated
profile, never a personal browser profile.

```sh
mkdir -p .local/demo-release docs/assets
npm pack @nxxxsooo/opencode-annotate@0.13.0 --ignore-scripts --pack-destination .local/demo-release
tar -xzf .local/demo-release/nxxxsooo-opencode-annotate-0.13.0.tgz -C .local/demo-release
vhs scripts/demo/terminal.tape
PLAYWRIGHT_MODULE="file:///path/to/playwright-core/index.mjs" \
  CHROMIUM_PATH="/path/to/chromium" node scripts/demo/browser.mjs
```

The terminal launcher resets only `.local/demo-terminal/data`, uses a dedicated
`tui.toml`, and records its terminal dimensions under `.local/demo-terminal/`.
The browser script creates and removes its own temporary profile and native-host
registration. No user configuration is changed. Font rendering, generated note IDs,
and the local server port can vary between captures.
