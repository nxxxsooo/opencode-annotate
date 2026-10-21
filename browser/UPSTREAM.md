# Annotate HTML-derived browser companion

Based on Asim Sayed's MIT-licensed [Annotate HTML](https://github.com/AsimSayed/annotate-html), Chrome Web Store release 1.0.0 (extension ID `ageaediaogfbmbmjoamkcloagepjcgdp`).

`upstream/annotate-1.0.0.js` preserves the unmodified released JavaScript, SHA-256 `ae30233d0db847c21ced822c63ec5f0ead1c6f361518ec28a21ea49defcd1206`; its MIT license is adjacent. Icons are preserved from that release. The original implementation credits Agentation for its element-identification approach.

`inspector.js` adapts the original element identification, computed-style snapshot, and accessibility collectors. This local enhancement replaces the in-page comment popup and volatile state with an extension-origin side panel, durable per-note storage, exact range context and validated selectors. It adds complete export and opt-in paired session delivery. The original upstream implementation is not injected alongside the enhanced runtime.

This is a distinct local extension with its own ID, not an official Annotate HTML update. It has no upstream update URL, analytics or external data service. Only user-requested Native Messaging can send feedback to a paired local OpenCode client. Native Messaging and side-panel installation are macOS/Chrome-only in this version.
