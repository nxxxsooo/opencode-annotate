# Changelog

## Unreleased

- Pass `PLANNOTATOR_TUI_SEND_INTENT` to the TUI. With the fork's `feat/send-intent`
  branch, `Ctrl+S` saves, returns and sends in one step without the OpenCode
  confirmation; `q` still asks. `Ctrl+S` is the only send key and the header shows one
  Send button; the clipboard copy and Review menu are hidden. Upstream binaries are unaffected.

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
