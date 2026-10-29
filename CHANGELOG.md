# Changelog

## 0.11.0 — automatic long-reply review

- Add opt-in automatic review of long replies through `autoAnnotate` and
  `autoAnnotateThreshold` in the plugin's JSONC options (default: off, 2,000 characters).
  Open the exact completed reply once after a successful turn in the active session;
  keep feedback sending explicit and skip background, failed and interrupted turns.
- Read plugin options through a location-scoped RPC so OpenCode 2.2's server-loaded
  TUI receives its JSONC settings, including updates to the auto-annotation switch.

## 0.10.0 — integrated TUI and conversation references

- Own the terminal reviewer under `tui/`, with its source, tests, native build and
  platform executables released with this package. OpenCode and AGY resolve that bundled
  reviewer; builds and CI no longer download or depend on a separate Plannotator fork.
- Keep theme inheritance, one-key send, input-method handling, Markdown bold-label fixes
  and existing annotation storage intact. User configuration lives in
  `~/.config/opencode-annotate/tui.toml`; clear the old launcher `binary` option to use the
  bundled reviewer, and copy any customized layout from the old configuration once.

- Add `/ref [title or session ID]` and `/ref --all [title]` to attach a bounded,
  attributed conversation snapshot to the captured session without resuming an idle assistant.
- Add `annotate.session_search` and `annotate.session_read` server tools with project-scoped
  title search, explicit cross-project lookup, pagination and long-message continuation.
- Add a server entrypoint to the existing package. Move its entry from `cli.json` to
  `opencode.json(c)` to enable both tools and TUI commands; retain existing options.
- Require OpenCode 2.2.0+. Full-history tools use the managed service's authenticated
  CLI HTTP API, guarded by a same-process check. `/ref` uses the connected TUI client.

## 0.9.1 — no steer error after sending

- Send TUI annotations to an idle session as steering input instead of queued input.
  OpenCode starts either one at once, but briefly listed the queued message, so an Enter on
  the empty prompt right after sending tried to steer it and showed "Failed to steer pending
  prompt" (HTTP 409) although the annotations had arrived. A busy session still queues them.

## 0.9.0 — input-method-safe keys

- Switch to Slash Saver's ASCII input source while a TUI review is browsed (OpenCode and
  `agy-annotate`) and while an OpenCode permission prompt is open, then restore the previous
  source. A Chinese input method otherwise swallows single-letter keys. The fork switches
  the comment and edit boxes back to the writing source and binds `Ctrl+E` to edit. New
  `inputSource` option: `false` disables, a path selects another helper.

## 0.8.1 — Antigravity (AGY) support and uncompressed history

- Antigravity CLI (AGY) support via `agy-annotate`:
  - New binary `agy-annotate` providing `status`, `tui`, `web`, and `queue` subcommands.
  - Native hooks integration (`SessionStart`, `PreInvocation`, `Stop`) delivering annotations directly into active AGY turns without external network services.
  - Decoupled bridge receiver to register and route between both `opencode` and `agy` session providers.
  - Browser companion panel badges (`[AGY]` / `[OPENCODE]`) and session chooser hints.
  - Adapted TUI launcher for AGY with automatic resolution of the local fork (`plannotator-tui-annotate`), full Dracula theme inheritance via `prepareTheme()`, 120-column measure layout, and one-key send (`PLANNOTATOR_TUI_SEND_INTENT`).
- Request session history uncompressed. OpenCode 2.2.0 compresses API responses at about
  80 KB/s, so `/annotate`, `/annotate-pick` and `/annotate-selection` waited 10–40 s on a
  page of long replies before the review opened; the same page now loads in milliseconds.

## 0.7.0 — one-key send and browser review rounds

### Text review

- Pass `PLANNOTATOR_TUI_SEND_INTENT` to the TUI. With the fork's `local/opencode` branch
  (proposed upstream as plannotator/plannotator-tui#109), `q` with notes returns and sends
  without the OpenCode confirmation; `Ctrl+S`, `E` and `S` send too, following `[keys]`,
  and `Ctrl+S` saves an open comment first. `Ctrl+C` returns so OpenCode asks. The header
  shows one **Send N back (q)** button; the clipboard copy and Review menu are hidden.
  Upstream binaries are unaffected.

### Browser review rounds

- Sending closes a review round: delivered notes leave the list, page markers renumber,
  and the panel is ready for the next round. **Restore last round** brings the latest
  delivered notes back; the last ten rounds per page are kept.
- Without a live session, the primary action is **Copy N notes & continue**; a copy icon
  beside Send offers the same when connected. Copying closes the round and supersedes a
  failed batch; a blocked clipboard keeps the round open.
- Copy writes the clipboard within the click, before saving an open draft, and falls back
  to the new `clipboardWrite` permission, so Chrome no longer refuses it on slow pages.
- Separate the two delivery modes: a **Live**/**Offline** marker beside the destination,
  **Send N notes** only with a live session, **Copy N notes** otherwise. A session that
  drops during Send keeps the notes and switches to Copy instead of showing an error.
- Detect a stale background worker after an update and offer **Reload Annotate**
  instead of `Unknown annotation action`.
- Strip invisible format characters from page titles, such as Feishu's title watermark.
- Reconnect page tools automatically after a reload or same-site navigation, fixing
  `Could not establish connection. Receiving end does not exist.` on Pick, Show on page
  and markers. When Chrome has withdrawn access, the panel asks for one icon click.

## 0.6.0 — annotate any session text

### Text review

- Add `/annotate-pick` to choose among recent replies and mid-turn progress updates, and
  `/annotate-selection` to review the message containing the last transcript selection.
- Move browser review to `/annotate-web` (pairing, URL, HTML file or `off`); `/annotate`
  now handles replies and documents only. Retire numbered `/annotate N`.

### Inherited TUI colors

- Add opt-in `inheritTheme` support for the color-capable Plannotator fork, including
  the OpenCode canvas, text, Markdown, borders, selection and cursor contrast pairs.
  Inherited colors also cover strong/emphasis text, list markers, rules, link labels,
  table headers and the send button.
- Validate a private per-review configuration before suspending the terminal; preserve
  the user's layout settings, including the fork's `doc_width`, and keep the themed
  config with recoverable drafts.

### Compact browser workspace

- Replace the always-expanded browser form with a selection-focused composer, numbered
  note queue, and persistent destination/delivery bar; keep controls visible at narrow widths and zoom.
- Autosave unfinished feedback by page, recover it after navigation or panel reload, and
  protect selection changes and competing-panel edits with explicit draft choices.
- Fix cancelling and reselecting the same element, add safe Show on page and revision-aware
  deletion Undo, and keep the intended destination visible while disconnected.
- Show pending/sent counts, distinguish original-batch retries from new feedback, and move
  copy/export/context utilities into More review options. **Save note** is now **Add note**.

## 0.5.0 — new package name

- Publish as `@nxxxsooo/opencode-annotate` from `nxxxsooo/opencode-annotate`. The old
  `opencode-plannotator-tui` package is deprecated; remove it and add the new one.
- No behavior changes from 0.4.2.

## 0.4.2 — OpenCode Annotate

The project is now called OpenCode Annotate. It is still published as
`opencode-plannotator-tui`, because the npm name `opencode-annotate` belongs to an
unrelated package.

- Fix `/annotate` on OpenCode 2.1.1: the terminal stayed blank and Plannotator TUI
  never opened, so Ctrl+C then quit the OpenCode client. The plugin now waits for
  the renderer to suspend and resume.
- Add webpage review: `/annotate page.html`, `/annotate https://…`, `/annotate web`
  and `/annotate web off`, with an Annotate HTML-derived Chrome companion and
  exact-session Native Messaging delivery. Text review is unchanged.
- The browser companion shows live sessions automatically, preselects a sole target
  without sending, saves the current note on **Send & continue**, keeps drafts per URL,
  and filters private values and hidden text from exported context.

## 0.3.0

- Select older completed replies with `/annotate 2`, `/annotate 3`, and so on.
  Bare `/annotate` and `/annotate 1` still select the latest reply.
- Count only eligible completed text replies across history pages; report missing
  replies and invalid numbers without opening a different source.
- `/annotate-last` now always selects the latest reply and ignores arguments.
  **Migration:** replace `/annotate-last file.md` with `/annotate file.md`.
- Verify numbered feedback delivery and fixed latest-reply selection in the real
  terminal smoke test, alongside 21 behavior tests.

## 0.2.2

- All confirmation dialogs, status notices, errors, and the feedback header sent
  to the assistant are now in English.

## 0.2.1

- Use an English command description in the slash menu and command palette.
- Compare actual published file contents when checking an existing npm release,
  avoiding false failures from platform-specific tar/gzip encoding.

## 0.2.0

Initial public release of the OpenCode adapter for Plannotator TUI.

- `/annotate [file]` and `/annotate-last` for replies or local Markdown/text documents.
- Same-terminal handoff and confirmed feedback to the captured session.
- Paginated completed-reply lookup and isolated document snapshots.
- Original document path and snapshot hash included in feedback.
- Recovery drafts on failure and preservation of archived annotations.
- Fourteen behavior tests and real terminal/API smoke coverage.
