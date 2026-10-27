# Compact browser annotation workspace

Status: implemented and locally verified on 2026-10-21. The user approved the preview and Build Contract with “Approve and implement” and subsequently confirmed the preview looked good. The everyday Chrome extension was reloaded on 2026-10-22, with running-worker parity and saved-data preservation verified below. Publication and post-reload interaction verification remain separate delivery boundaries.

## Saved working state — 2026-10-22

- Recovery starts with this document, then `PRODUCT.md`, `DESIGN.md`, and the browser-review section of `README.md`.
- The implementation remains in the working tree based on `a78bfbb`. The browser-workspace changes cover `CHANGELOG.md`, `README.md`, `browser/capture.js`, `browser/panel.css`, `browser/panel.html`, `browser/panel.mjs`, `browser/worker.mjs`, `smoke.py`, and `tests/browser.mjs`. `DESIGN.md`, `PRODUCT.md`, and this contract are untracked. Other working-tree changes have separate owners; this is not a complete checkout inventory.
- The pin-centering change in `browser/capture.js` predated the redesign and was preserved. The code, documentation, and that existing edit remain together in the current checkout; this Save did not commit or push them.
- Completed validation below belongs to the implementation session: 28 browser scenarios, 29 unit tests/package checks, and 13 isolated TUI/API smoke scenarios. Save verified the existing evidence and recovery files rather than rerunning the suites.
- The approved standalone preview and actual-extension captures remain under `Designs/personal/opencode-annotate/` in the governed sync workspace. `implementation/verification.md` and `implementation/browser-results.json` describe the real-extension evidence; `index.html` is the simulated preview. The temporary preview server was stopped.
- `.impeccable/` metadata is globally ignored, and `.local/browser-test/` is local test evidence. No release or version bump was performed. The later everyday-profile reload is recorded below.

### Everyday-profile reload — 2026-10-22

- The reported sidebar showed `Cannot read properties of undefined (reading 'value')` before the page title initialized. `modelFor(next)` in `browser/panel.mjs` expects `next.draft.value`.
- CDP `Debugger.getScriptSource` confirmed that Chrome's running worker matched `HEAD:browser/worker.mjs` at `a78bfbb` (106 lines), not the current checkout (184 lines). That older worker returned no `draft` record. The newly loaded sidebar and retained background worker were out of sync.
- Reloaded only the Annotate extension through `chrome.runtime.reload()`. Read back the new running worker and verified that its source matched the checkout and included draft handling. Production source files were not changed to resolve this incident.
- Compared SHA-256 digests of sorted `chrome.storage.local` entries before and after reload: all five entries, including four saved notes, were unchanged. There were no persisted composer drafts in this profile at the time.
- Verification covered loaded code and stored-data integrity. Picking, composing, and sending in the everyday profile were not exercised after reload; the earlier isolated-browser test results are a separate evidence set. No model turn, commit, push, or publication occurred in this incident or its Save.
- Recovery procedure: [Reload after browser companion updates](../README.md#reload-after-browser-companion-updates).

## Sources of truth and approved intent

- `PRODUCT.md`, `AGENTS.md`, `README.md`, and current browser/bridge behavior.
- GUI audit: `.impeccable/critique/2026-10-21T12-49-08Z__browser-panel-html.md`.
- User choices: both quick sending and batch collection through progressive disclosure; full compact redesign; retain calm palette; use existing evidence; preview first.
- Hindsight initiative: `kp-8cec0d81959f4c16a6c23baac579b8a2`.

## Desired behavior and UI scope

One bounded Chrome sidebar and its page highlighting, using the current HTML/CSS/module stack.

1. Compact header identifies Annotate and the current page. Export and context-preview utilities live behind a labeled More control.
2. With no selection, show a clear Pick element action and concise text-selection guidance. Existing notes remain the main content.
3. A selection reveals a composer with the selected quote, Comment/Question choice, labeled feedback input, local draft state, Add note/Save changes, and Discard draft. Cmd/Ctrl+Enter performs the labeled local save action.
4. Added notes collapse the composer into a numbered queue. Numbers match page markers. Each note separates quote, feedback, and pending/sent state; editing, deletion, and Show on page are accessible controls.
5. A persistent delivery region shows the destination, a meaningful pending count, and Send & continue. All-sent, disconnected, sending, and failure states explain the next action. It occupies layout space; content and focused controls never scroll behind it.

## Direction contract

**THESIS:** A selection-centered working sidebar with a persistent delivery decision. Page setup and exports yield space to current feedback and the note queue.

**OWN-WORLD:** Preserve the existing warm off-white/charcoal surfaces, rust/peach action accent, system sans, understated dividers, and compact native-control character. Use the accent for active selection and delivery. Make text and input boundaries readable in both themes.

**STORY:** Select a target, write useful feedback, add it to a review or send immediately, then return to a clear sent/pending state. Numbered notes maintain the relationship to the page.

**FIRST VIEWPORT:** Compact identity/page header; a short picker affordance; either an anchored composer or the numbered note queue in a dedicated scroll region; destination and count-aware delivery action below it. The 320px layout retains visible, reachable actions. More contains secondary exports.

**FORM:** User-approved progressive workspace inside the existing visual identity. No concept seed: this is a bounded surface with its structure and visual constraints explicitly selected in conversation.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Must preserve

- Captured-session targeting and explicit Send authorization; sending continues the intended session.
- A sole target may be preselected; several targets require a choice. Offline destinations never silently switch.
- Local URL isolation, exact/redacted selection evidence, concurrent revision checks, and private written feedback.
- Existing failed-batch identity/destination and safe retry semantics; edits to sent notes become pending revisions.
- Markdown/JSON output compatibility and recoverable clipboard failure.
- Current capture filtering and the existing pin-centering working-tree edit.

## Data, transitions, and errors

### Composer drafts

Keep one unfinished composer draft per page in extension-owned local storage, separate from saved/pending notes. Record its anchor, comment, kind, editing-note ID/base revision if any, and draft revision. Autosave while typing; show Saved locally only after storage acknowledgement. Flush on explicit transitions and keep input present when a write fails.

Restore a page's draft after navigation, panel reopening, or reload. Recheck its anchor and show changed/missing state rather than silently attaching it elsewhere. Input without an anchor is not an eligible outgoing annotation.

Selecting another element or editing another note while the current composer is dirty preserves the existing anchor/text and offers inline Add/Save & switch, Keep editing, or Discard & switch. Returning to another page uses that page's saved draft. Cancelling clears both the current composer and selection-identity bookkeeping so the same element can be selected again.

Concurrent draft/note updates use revision checks and an actionable conflict state rather than silent overwrite. Unchanged edits do not create unnecessary pending revisions.

### Notes and page relationship

Render stable correspondence between queue order and page-marker numbering on every mutation. Show on page locates the existing verified anchor, scrolls it into view, and highlights it without activating the page control. Changed, missing, or ambiguous anchors produce visible feedback and preserve the note. Send only anchor metadata to the page; comments remain private.

Delete uses the existing revisioned tombstone model with a visible Undo action. Undo restores the note's prior pending/sent meaning and checks the latest revision; it must not accidentally resend previously sent feedback or overwrite a newer edit.

### Delivery

The displayed count covers pending saved notes and the current eligible dirty composer, deduplicating an edited pending note. Send saves that composer before capturing the batch. No current text may be silently omitted. Disable duplicate submission while saving/sending and retain existing serialized transport behavior.

Keep the destination visible near Send. Use explicit labels for pending count, all-sent, connecting/disconnected, sending, and failure. A retry retains the original batch/target, even if the review has newer edits. Durable state derives from stored note revisions; immediate transport responses provide transient confirmation.

Connection selection and refresh remain discoverable; long/duplicate titles expose directory context in the chooser. Errors appear near the affected composer, target, or delivery action, with a live announcement.

## Accessibility and motion

- Native semantic controls with labels, note-specific action names, logical focus order, Escape dismissal, and visible focus that is never obscured.
- Text contrast at least 4.5:1 where applicable; necessary input boundaries at least 3:1 against adjacent colors.
- Desktop sidebar verification at 320×720 and 420×780, both themes; also 200% effective reflow at 210×390. No new horizontal overflow.
- Restrained state feedback only, no entrance choreography. Respect reduced-motion for page scrolling/highlighting.

## Preview and evidence

Canonical preview: `Designs/personal/opencode-annotate/index.html` under the governed sync workspace. Use a local live companion for feedback. It is a simulated interaction prototype, including sample page content and fake session delivery; it cannot send to OpenCode.

Preview states: empty, selected/composing, collected notes, edited sent note, sent, offline, changed/missing target, dirty-draft switch, and delete/undo. Width and theme controls and a sample-data reset are included. The user approved the preview.

Preview verification is recorded in that directory's `review/checks.md`, with ten screenshots under `review/`. The prototype passed exercised draft-switch, collect, delete/undo, simulated send, pending-count, same-target reselection, reload-recovery, and keyboard-focus scenarios. At 320, 420, and 210 CSS pixels, the content region fits its width and ends exactly above the delivery region. The finish reviewer requested retaining the destination name while offline; the correction and reconnect behavior were verified, and the reviewer scored that finding resolved with a SHIP disposition at preview scope. That review preceded user approval and the actual-extension verification recorded below.

## Must-pass scenarios

1. First use exposes capture guidance; no irrelevant empty form competes with the primary action.
2. Text/element selection opens an anchored composer; one valid note can be sent directly.
3. Several notes can be added, reviewed, edited, located on the page, and sent as a pending-only batch.
4. At 320×720 and 420×780, pointer and Tab users can reach every action without footer obstruction; zoom reflow remains usable.
5. Typing on A then selecting B never moves A's feedback silently; all switch choices behave as labeled.
6. Cancel then reselect the same element succeeds.
7. Unsaved draft text survives route A→B→A and panel reload/reopen; failed local persistence does not clear input or claim success.
8. Missing or changed anchors remain identifiable; Show on page never activates a control or substitutes an ambiguous target.
9. Deletion can be undone without changing the prior pending/sent meaning; stale undo/edit/draft writes fail clearly.
10. Restored sent reviews display all-sent state; editing one sent note sends only that revision.
11. Multiple sessions require a choice; disconnected/failed sending preserves notes and original destination/batch for retry.
12. Copy/export, privacy filtering, URL isolation, duplicate-send prevention, and existing bridge/TUI behavior remain verified.

## Implementation slices

- [x] Draft lifecycle and selection identity: storage boundary, dirty transitions, recovery, revision handling, and meaningful regression probes.
- [x] Complete progressive sidebar: layout, composer/queue transitions, note identity, delivery counts/states, utility disclosure, and keyboard/contrast behavior.
- [x] Page location and local note recovery: Show on page, anchor-status feedback, Delete/Undo, and concurrent-edit behavior.
- [x] Integrated verification and finish: real select→compose→collect→send workflow, narrow/wide light/dark and zoom captures, independent finish review, and extracted design-system documentation.

## Verification and delivery

Use the real isolated browser harness and focused meaningful regressions for the discovered failures. Run `npm run check`, `npm run test:browser`, and the required isolated smoke test for the final change. Use an installed Chromium executable where the default Playwright browser is absent. Preview simulations supplement but do not replace actual extension checks.

After implementation acceptance, follow `docs/releasing.md` and the project's delivery workflow, preserving the npm files allowlist and separately checking published versus locally installed versions. Production implementation begins only after approval of this contract and the requested preview.

### Completed validation

- `npm run test:browser`: 28 scenarios passed, zero page errors, using the actual extension in an isolated Chromium profile. Coverage includes post-action focus, route/panel draft recovery, conflicts, failed storage, fresh direct send, original-batch retry, same-element reselection, and all-sent restoration after reload.
- `npm run check`: 29 unit tests passed; npm packaging retained its 30-file allowlist.
- `npm run test:smoke`: 13 real TUI/API checks passed with OpenCode 2.1.2 and Plannotator TUI 0.9.4, using isolated sessions and `resume: false`. A discovered harness startup race was fixed by waiting for the fixture keymap to mount before issuing a command.
- Nine actual-extension screenshots cover 320×720 and 420×780 in light/dark, plus 210×390 effective reflow. Evidence is under `.local/browser-test/` and the preview directory's `implementation/` archive.
- The finish reviewer found the approved visual direction faithful, then scored its two requested corrections—focus transfers after controls unlock and durable acknowledgement of consumed captures—resolved, with a ship disposition at that scope.
- `DESIGN.md` and `.impeccable/design.json` record the implemented tokens, components, layout, and page-overlay distinction. The design sidecar is locally ignored by the existing global Git rule.

The everyday Chrome profile, native side-panel-shell presentation, and a screen-reader session were not part of the implementation verification above. The 2026-10-22 live-profile reload separately verified worker-source parity and saved-data integrity, not those interaction or accessibility scenarios. No version bump or publication was performed.

## Superseded by review rounds — 2026-10-23

Accepted by the user in the everyday Chrome profile (“works”) after three fixes. Criterion 10 and the pending/sent queue above no longer describe current behavior:

- Delivery closes a round: delivered notes leave the working list, keep their `sentRound`/`sentAt`/`sentVia`, and stay restorable through **Restore last round** (ten rounds per page). Editing a delivered note now requires restoring its round.
- Two explicit delivery modes: a **Live** session gets **Send N notes**; otherwise **Copy N notes** copies the round for any agent and closes it. A send that loses its session keeps the notes and switches to Copy.
- The worker reinjects page tools after a reload while `activeTab` still applies; a `PROTOCOL` mismatch between panel and worker shows **Reload Annotate** instead of raw action errors.

Current behavior lives in the README and CHANGELOG (Unreleased → Browser review rounds); `npm run test:browser` covered 34 scenarios at acceptance. Not yet committed or released at the time of this note.

## Residual risks

Draft persistence introduces concurrency and storage-failure paths. Existing saved-note/outbox data must remain readable throughout. DOM targets can disappear between capture and reveal; present that state explicitly. The preview cannot validate native messaging, extension CSP, or the real side-panel shell, so those require the production browser harness.
