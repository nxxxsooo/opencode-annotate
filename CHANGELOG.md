# Changelog

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
