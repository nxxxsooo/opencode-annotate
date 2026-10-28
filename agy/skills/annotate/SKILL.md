---
name: annotate
description: Review assistant replies or local documents in Plannotator TUI, or pair Google Chrome companion for live visual webpage annotation. Use when the user types /annotate, /annotate-web, asks to annotate a reply or document, or requests webpage review.
---

# Annotate (`agy-annotate`)

Use this skill when the user runs `/annotate`, `/annotate-web`, or asks to annotate assistant responses, documents, or webpages.

## Execution Guide for the Agent:

### 1. When the user types `/annotate` (or asks to review the last reply):
Run the command:
```bash
node /Users/mingjian/Documents/sync/GitHub/opencode-annotate/agy/cli.mjs tui
```
This automatically opens an interactive Plannotator TUI window (via Ghostty or Terminal). When the user finishes adding annotations and presses `q` (or `Ctrl+S`), the window closes, the command outputs the feedback, and you immediately proceed to apply the requested changes.

### 2. When the user specifies a document (e.g., `/annotate path/to/doc.md`):
Run the command:
```bash
node /Users/mingjian/Documents/sync/GitHub/opencode-annotate/agy/cli.mjs tui "<path/to/doc.md>"
```

### 3. When the user types `/annotate-web` (or provides a URL/HTML file):
Run the command:
```bash
node /Users/mingjian/Documents/sync/GitHub/opencode-annotate/agy/cli.mjs web [url-or-html-path]
```
Inform the user that the session is paired with Chrome and ready in the Annotate side panel (`Alt+Shift+A`). When the user sends notes from Chrome, they are delivered directly to this session.
