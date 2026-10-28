# opencode-annotate

Unofficial OpenCode annotation plugin. The owned Rust reviewer in `tui/` supplies text
review; the browser companion supplies webpage review. This repository owns both UIs,
routing, native messaging and captured-session feedback delivery.

- Runtime entry: `tui.ts`; text behavior: `review.mjs`; browser: `browser/`; bridge: `bridge/`; AGY companion: `agy/`.
- Native reviewer: `tui/`; build with `npm run build:tui`, verify with `npm run check:tui`.
- Session references: `server.ts` registers tools through `session-tools.mjs`;
  `reference-command.mjs` owns `/ref`; `session-reference.mjs` bounds and formats history.
  `server-history.mjs` uses the authenticated CLI API with a same-server-process check.
- `npm run check` uses the bundled executable. The TUI is ordinary owned source: no
  submodule, separate fork, upstream download or synchronization workflow.
- `npm run test:smoke` additionally needs Python 3, tmux and OpenCode; it uses an
  isolated test session and never resumes a model turn.
- `npm run test:references` verifies server tools and `/ref` in isolated sessions,
  also without a model turn. References are queued with `resume: false`.
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
