# opencode-annotate

Unofficial OpenCode annotation plugin. The owned Rust reviewer in `tui/` supplies text
review; the browser companion supplies webpage review. This repository owns both UIs,
routing, native messaging and captured-session feedback delivery.

- Runtime entry: `tui.ts`; text behavior: `review.mjs`; browser: `browser/`; bridge: `bridge/`; AGY companion: `agy/`.
- Safari: `npm run build:safari` then `npm run install:safari`; shared sources stay
  in `browser/`, engine differences in `browser/env.mjs`, app sources in `safari/`.
  Safari requires an App-Sandboxed extension: its standalone panel copies local
  rounds out instead of delivering to sessions. Chrome keeps native delivery.
- Native reviewer: `tui/`; build with `npm run build:tui`, verify with `npm run check:tui`.
- Server entry: `server.ts` registers configuration so the single `opencode.json(c)`
  entry continues to supply plugin options to the TUI on OpenCode 2.2.
- `npm run check` uses the bundled executable. The TUI is ordinary owned source: no
  submodule, separate fork, upstream download or synchronization workflow.
- `npm run test:smoke` additionally needs Python 3, tmux and OpenCode; it uses an
  isolated test session and never resumes a model turn.
- Smoke fixtures record production delivery intent, then force `resume: false`
  before calling the API.
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
