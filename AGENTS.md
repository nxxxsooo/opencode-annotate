# opencode-annotate

Unofficial OpenCode annotation plugin. Plannotator TUI supplies text review;
the Annotate HTML-derived browser companion supplies webpage review. This
repository owns routing, native messaging and captured-session feedback delivery.

- Runtime entry: `tui.ts`; text behavior: `review.mjs`; browser: `browser/`; bridge: `bridge/`; AGY companion: `agy/`.
- `npm run check` requires the upstream `plannotator-tui` executable.
- `npm run test:smoke` additionally needs Python 3, tmux and OpenCode; it uses an
  isolated test session and never resumes a model turn.
- Drive keys or mouse only in isolated test sessions, never the user's real sessions.
  Clicking a queued message moves it into the prompt, so a following Enter starts a model
  turn; select text elsewhere and check the prompt holds only the command before Enter.
- Preserve captured-session targeting, terminal restoration, snapshot isolation,
  explicit confirmation and archived-note recovery.
- Bump `PROTOCOL` in `browser/protocol.mjs` whenever panel ↔ worker actions or response
  fields change; Chrome can keep an older worker beside a newer panel, and the panel uses
  the mismatch to offer **Reload Annotate**.
- Keep npm artifacts limited to the `files` allowlist. Do not commit local settings,
  transcript captures, credentials or machine-specific paths.
- Releases follow `docs/releasing.md`. Publishing and the maintainer's installed
  package are separate states; verify both.
