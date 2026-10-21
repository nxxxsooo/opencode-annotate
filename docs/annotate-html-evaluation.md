# Annotate HTML 1.0.0: shipped-artifact evaluation

Evaluated 2026-10-19; distilled during Full Save on 2026-10-20. This record explains the reuse decision, not a new investigation or a release announcement.

## Decision

Reuse Annotate HTML's element inspection and visual annotation model, then supply project-owned persistence, private editing and captured-session delivery. The original extension is suitable for a short, immediate-feedback session; its shipped implementation does not supply the durable, multi-page workflow required here.

## Artifact and evidence

- Chrome Web Store ID: `ageaediaogfbmbmjoamkcloagepjcgdp`; manifest version 1.0.0, CRX3, 31,105 bytes.
- Original CRX SHA-256: `daee2ed712f46f3ec0bd7302be285c8118cd17f46351e5abbc9420d8d50b1f6f`.
- ZIP payload SHA-256: `237d2403cdadcc0186f93f9b705e476cc576687fd384de764b97a101c1cfe9ad`.
- Preserved released JavaScript: [annotate-1.0.0.js](../browser/upstream/annotate-1.0.0.js), SHA-256 `ae30233d0db847c21ced822c63ec5f0ead1c6f361518ec28a21ea49defcd1206`; [MIT license](../browser/upstream/LICENSE).
- REA parent Evidence: `ev_adf1d4bedacb47e75a3fbf377e403594e869ca9b2af8de32b5df8ab5846793e7`.
- REA parsed both shipped JavaScript files with no parse failures. Application inventory was complete; semantic relationships remained unknown in part, with 1,663 retained unknowns. Static parsing did not execute the extension.
- All three contained CRX signatures verified mathematically, and one signer key bound to the requested extension ID. Google trust roots were not independently pinned; acquisition used Google's official HTTPS extension update service.

The raw acquisition receipt, original CRX, signature report and complete exported REA bundle remain in the local analysis archive. They are not npm runtime artifacts. Source attribution is maintained in [UPSTREAM.md](../browser/UPSTREAM.md).

## What the released code established

| Question | Observation in the 1.0.0 release | Consequence for this project |
|---|---|---|
| Permissions and injection | `activeTab` and `scripting`; user-triggered isolated-world, top-frame injection | Keep opt-in page access; do not add global host access |
| Export | `annotate.js:219–273` defaults to `detailed`; full URL, styles and accessibility are in a `forensic` branch without an observed mode-switch entry | Export the required fields explicitly, not merely collect them internally |
| Draft lifetime | Annotations live only in closure-local memory; no persistent-store calls found | Provide extension-owned saved drafts and revision checks |
| SPA routes | Export reads the current pathname; no route-change isolation found | Bind every saved note to its original page identity |
| Selectors | At most four levels, class truncation at underscore, no escaping or uniqueness validation | Treat selectors as verified hints and surface missing/ambiguous targets |
| Editable text | Nearby context reads sibling `textContent` without excluding editors | Filter emitted text, including neighboring editable descendants |
| UI privacy | Feedback popups and marker tooltips enter the shared page DOM | Keep user-written feedback in extension-origin UI; expose only target metadata and numbers to the page |
| Copy failure | `clipboard.writeText(...).then(...)` has no rejection recovery | Offer an explicit selectable preview when copying fails |

No extension-owned annotation upload path was found in the complete shipped JavaScript. This is a bounded static result, not a runtime traffic audit. An isolated JavaScript world does not prevent the host page from observing shared DOM nodes.

## Lessons confirmed by the local integration

### Filter private content; do not prohibit its container

The first local guard rejected a container whenever it contained a hidden icon or editable descendant. A visible dashboard heading with an `aria-hidden` SVG therefore became impossible to annotate. A failed pick also left click interception enabled, blocking ordinary page interaction.

The corrected boundary in [inspector.js](../browser/inspector.js) permits the visible target while excluding hidden/editor text and input values from its quote/context. A control can be identified by label or type without reading its value. [capture.js](../browser/capture.js) exits pick mode on success **and** failure and disposes owned listeners when reinjected.

### Preselection is not authorization

Requiring Find → Select → Pair before feedback added unnecessary friction. A sole live destination can be displayed automatically while reserving binding and model continuation for the explicit **Send & continue** click. Multiple live destinations require one choice; a disconnected prior destination must never silently switch to the remaining session.

### Verify the recovery path, not only the happy path

The browser regression scenarios cover failed-pick recovery, private descendants, retained drafts, stale revisions, duplicate sends and lost/offline delivery. Text-review smoke tests use real OpenCode inbox admission with `resume: false`, separating routing evidence from any claim that a model executed the feedback.

## Recovery and current operating truth

- [Integration plan and verified boundaries](annotate-html-integration-plan.md)
- [Installation and explicit routing](../README.md#local-browser-enabled-installation)
- [Rollback and release-identity boundary](releasing.md#local-rename-and-browser-enabled-version)
- [Browser regression scenarios](../tests/browser.mjs)

Sources: [Annotate HTML repository](https://github.com/AsimSayed/annotate-html), [Chrome Web Store listing](https://chromewebstore.google.com/detail/annotate-html/ageaediaogfbmbmjoamkcloagepjcgdp), and the locally retained shipped-artifact Evidence above. Claims about the original release and the enhanced local companion are intentionally separate.
