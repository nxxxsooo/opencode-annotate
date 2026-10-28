---
name: annotate
description: Review assistant replies or local documents in the bundled Annotate TUI, or pair the Chrome companion for webpage annotation. Use for /annotate, /annotate-web, reply/document annotation, or webpage review in an AGY session.
---

# Annotate (`agy-annotate`)

Use this skill when the user runs `/annotate`, `/annotate-web`, or asks to annotate assistant responses, documents, or webpages.

## Execution Guide for the Agent:

### 1. When the user types `/annotate` (or asks to review the last reply):
Run the command:
```bash
npx --yes --package @nxxxsooo/opencode-annotate@latest agy-annotate tui
```
This opens the bundled reviewer in an interactive window (via Ghostty or Terminal). When the user finishes adding annotations and presses `q` (or `Ctrl+S`), the window closes, the command outputs the feedback, and you proceed to apply the requested changes.

### 2. When the user specifies a document (e.g., `/annotate path/to/doc.md`):
Run the command:
```bash
npx --yes --package @nxxxsooo/opencode-annotate@latest agy-annotate tui "<path/to/doc.md>"
```

### 3. When the user types `/annotate-web` (or provides a URL/HTML file):
Run the command:
```bash
npx --yes --package @nxxxsooo/opencode-annotate@latest agy-annotate web [url-or-html-path]
```
Inform the user that the session is paired with Chrome and ready in the Annotate side panel (`Alt+Shift+A`). When the user sends notes from Chrome, they are delivered directly to this session.
