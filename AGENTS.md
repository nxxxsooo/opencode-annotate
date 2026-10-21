# opencode-annotate

Unofficial OpenCode annotation plugin. Plannotator TUI supplies text review;
the Annotate HTML-derived browser companion supplies webpage review. This
repository owns routing, native messaging and captured-session feedback delivery.

- Runtime entry: `tui.ts`; text behavior: `review.mjs`; browser: `browser/`; bridge: `bridge/`.
- `npm run check` requires the upstream `plannotator-tui` executable.
- `npm run test:smoke` additionally needs Python 3, tmux and OpenCode; it uses an
  isolated test session and never resumes a model turn.
- Preserve captured-session targeting, terminal restoration, snapshot isolation,
  explicit confirmation and archived-note recovery.
- Keep npm artifacts limited to the `files` allowlist. Do not commit local settings,
  transcript captures, credentials or machine-specific paths.
- Releases follow `docs/releasing.md`. Publishing and the maintainer's installed
  package are separate states; verify both.
