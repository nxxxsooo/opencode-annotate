# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

This record concerns the Chrome browser companion. The same plugin also routes text and document review to Plannotator TUI.

## Users and purpose

OpenCode users reviewing a webpage alongside an agent session select text or an element, describe a change or ask a question, then deliver that feedback to the intended session. Both immediate single-note delivery and collecting several notes are supported. The user confirmed a progressive workflow that reveals composition when needed and keeps collected notes easy to review.

## Operating context

- Desktop Chrome side panel beside the page being reviewed; representative widths are 320–420 CSS pixels.
- Browser companion sources are in `browser/`; Chrome Native Messaging connects it to a captured local OpenCode session.
- Selection evidence belongs to the reviewed page. Written feedback belongs to extension-owned UI and storage.
- A Send action saves eligible current feedback, delivers pending notes, and continues the displayed session. Collecting feedback remains local until Send.

## Capabilities and constraints

- Text/element selection, comment/question feedback, multiple notes, editing, local saved-note recovery, Markdown copy, and JSON export.
- Session choice is explicit when multiple targets exist. Disconnection preserves the intended destination and retryable batch.
- Notes remain isolated by URL, including SPA routes; revision checks protect against stale updates.
- Keep native controls, keyboard access, legible text, visible focus, and usable zoom/reflow in the narrow sidebar.
- Existing implementation uses plain HTML, CSS, and JavaScript modules; the redesign retains that stack.

## Confirmed design commitments

The user approved a complete compact-sidebar redesign retaining the calm light/dark visual identity. Scope includes unobscured controls, draft/selection correctness, numbered notes connected to page elements, and clearer destination and pending/sent state. Use existing product and audit evidence; an interactive preview must be approved before production implementation.

## Evidence on hand

- `README.md` documents current capabilities, routing, and platform boundaries.
- `tests/browser.mjs` exercises the real extension in an isolated profile.
- `.impeccable/critique/2026-10-21T12-49-08Z__browser-panel-html.md` records the GUI audit.
- `docs/browser-workspace-design.md` is the active design/build contract.

## Product principles

1. Feedback stays attached to the page and selection it describes.
2. Show the task, its state, and its destination at the decision point.
3. Reveal optional controls as needed, preserving both quick and batch workflows.
4. Protect local work through navigation, failure, and concurrent edits.
