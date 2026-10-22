---
name: OpenCode Annotate
description: Compact annotation workspace with a warm, calm, task-focused sidebar.
colors:
  bg: "light-dark(#faf9f5, #20201f)"
  surface: "light-dark(#fff, #292927)"
  soft: "light-dark(#f0eee8, #33322f)"
  text: "light-dark(#27251f, #f2eee5)"
  muted: "light-dark(#686257, #c2bbae)"
  line: "light-dark(#ddd8ce, #49463f)"
  input: "light-dark(#8c8475, #928a7e)"
  accent: "light-dark(#944525, #f2ad90)"
  on-accent: "light-dark(#fff, #29201b)"
  success: "light-dark(#3c6548, #a5c6ab)"
  warning: "light-dark(#865122, #e9bb7e)"
  error: "light-dark(#a12929, #ffb3ac)"
  page-overlay-accent: "#c96442"
  page-overlay-fill: "#c9644210"
  page-overlay-ink: "#fff"
typography:
  body:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "-.015em"
  headline:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-.015em"
  section:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.5
  control:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 550
    lineHeight: 1.5
  action:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  compact: "5px"
  control: "6px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  control: "10px"
  row: "12px"
  gutter: "16px"
  section: "18px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
    width: "100%"
  button-primary-disabled:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.muted}"
  button-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
  button-soft:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "4px 3px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.compact}"
    padding: "0"
    width: "32px"
    height: "32px"
  feedback-kind:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.compact}"
    padding: "4px 9px"
  feedback-kind-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
  feedback-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "{spacing.control}"
    width: "100%"
  selected-quote:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.compact}"
    padding: "{spacing.control}"
  note-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    padding: "15px 0 14px"
  delivery:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    padding: "10px 16px 12px"
---

# Design System: OpenCode Annotate

## Overview

**Creative North Star: "Compact annotation workspace"**

Warm, calm, task-focused. Flat/tonally layered surfaces and familiar native controls keep the reviewed page and written feedback easy to follow. The user approved the compact progressive sidebar and its interactive preview within this visual identity.

This records the implemented Chrome companion: `browser/panel.css` and `browser/panel.html` define its visual system; `browser/panel.mjs` owns interaction states; `browser/capture.js` owns the separate page overlay. Product context and the approved workflow remain in `PRODUCT.md` and `docs/browser-workspace-design.md`.

**Key Characteristics:**
- Warm light/dark surfaces with a rust/peach action accent.
- Compact system typography and familiar native controls.
- Independently scrolling work area with an in-flow delivery region.
- Numbered notes, explicit states, and progressive disclosure.

## Colors

Sidebar tokens preserve the source `light-dark()` pairs under `color-scheme: light dark`; the first argument is light, the second dark.

### Primary

`accent` is the rust/peach action color for delivery, active picking, the current note number, focus, caret, and text selection. `on-accent` supplies its foreground. State colors `success`, `warning`, and `error` accompany explicit sent, anchor, storage, or delivery messages.

### Neutral

`bg` is the warm off-white/charcoal canvas; `surface` supports controls; `soft` distinguishes selected evidence and disabled delivery. `text` and `muted` separate feedback from supporting context. `line` supplies quiet dividers; the stronger `input` defines necessary control boundaries.

### Injected page surface

The `page-overlay-*` tokens belong only to `capture.js`'s closed shadow root. Its fixed accent, translucent fill, and white marker text/border stay independent of the sidebar theme. They are not a replacement sidebar palette. No tonal ramps are defined in source.

## Typography

Use the system sans stack in the frontmatter. The hierarchy is deliberately compact: body/feedback (14px), labels/quotes/status (13px), identity (16px), and empty-state heading (17px). Section headings use body size with weight 650; field labels use label size with weight 600. Default buttons use weight 550; delivery uses 600.

Sidebar note numbers use tabular numerals (12px, weight 650). Shortcuts use `system-ui` (12px/1.3); context preview uses `ui-monospace, monospace` (12px/1.5). Empty-state copy is limited to 28ch. The finish reviewer waived the generic flat-type-hierarchy warning for the user-approved Operate density; preserve this scale.

## Layout

The body is a viewport-height grid (`height: 100dvh`, `grid-template-columns: minmax(0, 1fr)`, `grid-template-rows: auto minmax(0, 1fr) auto`, `overflow: hidden`). Header and delivery occupy their own rows. The middle work area has `min-height: 0`, `min-width: 0`, and `overflow: auto`; it scrolls independently and ends above delivery.

- Header padding: 12px 16px 13px. Work area: 14px 16px 20px, with 16px scroll padding. Delivery: 10px 16px 12px.
- Picker, headings, feedback-kind choices, composer actions, note metadata, and utility actions wrap structurally with flexbox. Notes use `24px minmax(0, 1fr)` columns and a 10px gap.
- Long feedback and quotes wrap anywhere; page and destination labels truncate visually, with full titles available. Quote and context-preview regions scroll at maximum heights of 80px and 240px respectively.
- Representative sidebar widths are 320–420px; 210px is the effective reflow check. These are verification sizes, not CSS breakpoints. Source has no width media queries or fixed sidebar width.

## Elevation & Depth

The sidebar is flat/tonally layered, with no shadows. Background shifts, one-pixel borders, whitespace, and divider lines distinguish evidence, controls, and sections. Delivery remains in layout rather than covering the notes. The injected page surface uses a fixed, pointer-transparent overlay above page content; this is a separate layering mechanism.

## Shapes

Controls use gentle corners (6px); compact controls and selected evidence use 5px. Sidebar note numbers are centered circles with a 24px border-box. Page markers declare a 26px content box with a 2px white border, circular corners, and centered `600 12px/1 system-ui` text. Highlight rectangles use a 2px stroke.

Sidebar icons are inline stroke SVGs (normally 18px, stroke width 1.7, rounded caps/joins); context-specific icons range from 14px to 19px. The sidecar embeds the existing path data directly.

## Components

### Buttons and choices

- **Primary delivery:** full width, minimum height 39px. Disabled delivery uses `soft`, `line`, and `muted` at full opacity. Its label communicates pending count, sending, reconnect, retry, or all-sent state.
- **Default:** outlined `surface` control, minimum height 36px. Hover changes the border to `accent`. Active picking fills the button with the accent and takes the full row.
- **Soft:** transparent fill with the quiet divider border; used for Keep editing.
- **Text:** muted, transparent, minimum height 32px; hover reveals an underline and stronger text.
- **Icon:** 32px square, transparent at rest; hover uses `soft` and stronger text. Accessible names identify the action.
- **Feedback kind:** native buttons in a radio group, minimum height 32px. The checked option gains a surface fill and input border; arrow keys change the choice.

Buttons use muted text and 0.6 opacity when disabled, except the primary override above. Interactive sidebar controls retain a visible 2px accent focus outline with 3px offset. Focus requests wait for locked controls to become enabled before landing on the next task control.

### Input and selected evidence

Feedback uses a labeled, vertically resizable textarea (minimum height 96px, 10px padding, 8,000-character limit), with an accent caret and muted placeholder. Session selection retains a native select, with 8px padding and label-sized text. Draft errors and recovery choices sit beside the composer; input borders do not gain an invented error style.

Selected evidence is a compact tonal block with a quiet border and picker icon. Composition appears when a selection or restored draft exists. A new capture does not silently replace dirty feedback; inline choices preserve the relationship. Consumed captures remain consumed across restoration.

### Note queue and delivery

Rows separate the numbered marker, muted Show on page quote, feedback, pending/sent metadata, and Edit/Delete controls. The first row omits the top divider and uses 5px top padding. Sent state includes a check icon and text; warnings retain the note. Deletion exposes an inline Undo action.

Delivery keeps destination, count-aware action, and live status together. The destination remains named when disconnected. Utilities and the native session chooser are disclosed in the scrolling work area. Sidecar snippets are styling and semantic-state examples; `panel.mjs` supplies their application behavior.

Show on page scrolls smoothly to a verified anchor and displays a highlight for 1,600ms without activating the element. Reduced motion changes page scrolling to `instant`; the sidebar's reduced-motion rule enforces `scroll-behavior: auto`. There are no entrance animations or CSS transition timings to extract.

## Do's and Don'ts

### Do:
- Do preserve the source light/dark pairs and keep injected page-overlay colors separate.
- Do retain the compact system type scale, visible focus, and familiar native controls.
- Do keep the work area independently scrollable and delivery in its own grid row.
- Do pair note state with text and keep feedback, selection, and destination recognizable.

### Don't:
- Don't turn verification widths into invented CSS breakpoints.
- Don't cover composer or queue actions with a fixed footer.
- Don't introduce shadows, decorative ramps, or entrance choreography into this extracted system.
- Don't replace the approved compact hierarchy with display-scale headings.
