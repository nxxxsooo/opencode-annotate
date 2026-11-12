# Plan: move conversation references to Another

Status: planned for the next release (Annotate 0.16.0), decided 2026-11-12.
Feature work for Another is tracked in its own repository: `docs/ref-and-watch.md` on
branch `feat/ref-menu` (reconciled 2026-11-12, commit `1be8a7a`; provider filter on
Alt+P, one `opencode2-sessions` plugin for reference and session watching).

## Decision

| Date | Decision | Basis |
|---|---|---|
| 2026-11-12 | Move `/ref` conversation references out of Annotate into Another. Annotate keeps reviewing replies, documents and webpages. | Mingjian: “下一版本的发布计划把 Reference 参考对话迁移到 Another 项目，从这个项目里迁出”. |
| 2026-11-12 | Drop inline annotation from references (`Ctrl+T`, `/ref --tui`). Another's `/ref` selects, comments and sends; annotate afterwards with `/annotate` if needed. | Mingjian chose full decoupling over a cross-project reviewer interface. |
| 2026-11-12 | Adjust the command for Another: cross-agent picker, `/ref <keywords>`, one-step comment and send, head-and-tail context with an `another://` link. | Mingjian approved the proposal (“ok”). |

Why Another: it already indexes sessions from OpenCode, Claude Code, Codex, Pi,
Antigravity and Qwen, scopes them to the current project, and exposes bounded context
(`another context`) plus a read-only MCP server. A reference there can come from any
agent, not only OpenCode.

## Order of delivery

1. **Another ships `/ref` first** (its next minor). Annotate stays unchanged until then,
   so nobody loses the command.
2. **Annotate 0.16.0 removes references** right after. Both releases go out the same day
   to keep the window with two `/ref` commands short.

## Annotate 0.16.0 scope

- Delete `reference-command.mjs`, `session-reference.mjs`, `session-tools.mjs`,
  `server-history.mjs`, `reference-comment.tsx`, `session-reference.test.mjs`,
  `server-history.test.mjs` and `tests/references-smoke.py`.
- Move `finishedAssistant` (used by `review.mjs` for the latest completed reply) into
  `review.mjs`, with its tests in `review.test.mjs`.
- Keep `server.ts`, reduced to `registerConfiguration`: OpenCode 2.2 drops TUI plugin
  options from its server inventory, so option sync still needs the server entry. Users'
  single `opencode.json(c)` entry stays the same.
- Remove the `annotate.session_search` / `annotate.session_read` agent tools and their
  `annotate_session_*` permissions. Another's MCP server covers agent-side search and read.
- Remove reference hooks from `tui.ts`, the `test:references` script, `package.json`
  `files` and description, and reference sections in README, AGENTS.md and smoke fixtures.
- CHANGELOG (breaking): “`/ref` moved to Another. Install Another and run
  `another setup` to get `/ref` across all your agents.”

## Another scope (summary; details in Another's plan)

- New embedded OpenCode 2 integration (beside `opencode2-title-policy`), installed and
  removed by `another setup` / `another integrations`.
- Command adjustments approved 2026-11-12: `/ref` keeps its name; the picker covers every
  enabled provider with provider tags and a provider filter (current project by default,
  `Ctrl+A` for all, current session excluded); `/ref <keywords>` pre-filters with full-text
  search; comment box and confirmation merge into one step (Enter sends to the named
  destination, Esc cancels); context uses Another's head-and-tail bounds plus an
  `another://session/...` link readable through `another mcp`; `--tui` is dropped.
- Delivery keeps Annotate's accepted semantics: one ordinary user prompt; established
  sessions continue (`steer`, `resume: true`) after confirmation; before the first user
  message references wait (`resume: false`); on home, a session is created only after
  confirmation. Captured destination and explicit confirmation stay.

## Acceptance checks

- Another: `/ref` works in an isolated OpenCode session for an OpenCode source and at
  least one other provider, on home, before and after the first message; integration
  install, update and removal pass; Windows CI green.
- Annotate: `npm run check`, `npm run test:smoke`, `npm run test:browser` pass; no
  reference file, tool or permission remains in the packed tarball; `/annotate` still
  reviews the latest completed reply; plugin options still reach the TUI.
- Maintainer install: Another's `/ref` loaded and Annotate's gone, with no duplicate command.

## Open risks

- Verify that OpenCode 2 loads a TUI slash-command plugin from Another's plugin
  directory the same way it loads the title-policy server plugin; if not, Another needs
  an explicit `tui` entry in config.
- Users who update only one package see either two `/ref` commands or none until the
  other updates; release notes on both sides say so.
