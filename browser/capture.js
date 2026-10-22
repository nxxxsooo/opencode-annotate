(() => {
  if (globalThis.__opencodeAnnotate === true) throw new Error("Refresh this page once to update annotation tools. Saved notes will remain.")
  globalThis.__opencodeAnnotate?.dispose()
  if (!["text/html", "application/xhtml+xml"].includes(document.contentType)) throw new Error("Only HTML pages are supported")
  const listeners = new AbortController()
  const on = (target, event, handler, options = {}) => target.addEventListener(event, handler, { ...options, signal: listeners.signal })
  const host = document.createElement("div")
  host.setAttribute("data-opencode-annotate", "")
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important"
  const root = host.attachShadow({ mode: "closed" })
  const style = document.createElement("style")
  style.textContent = '.box{position:fixed;pointer-events:none;border:2px solid #c96442;background:#c9644210}.pin{position:fixed;display:grid;place-items:center;background:#c96442;color:#fff;border:2px solid #fff;border-radius:50%;font:600 12px/1 system-ui;width:26px;height:26px;pointer-events:none}'
  root.append(style); document.documentElement.append(host)
  const box = document.createElement("div"); box.className = "box"
  const highlight = document.createElement("div"); highlight.className = "box"
  let highlighted, highlightTimer
  let picking = false, url = location.href, timer, markers = [], active = true
  function send(anchor = null, error = null, modeOnly = false) {
    if (!active) return
    try {
      chrome.runtime.sendMessage({ action: "capture", page: { url: location.href, title: document.title }, anchor, error, picking, modeOnly }).catch(dispose)
    } catch { dispose() }
  }
  function setPicking(value, notify = true) {
    picking = value
    if (picking) root.append(box); else box.remove()
    if (notify) send(null, null, true)
  }
  function selection() {
    if (picking || !active) return
    const selected = getSelection()
    if (!selected?.rangeCount || selected.isCollapsed || selected.anchorNode?.getRootNode() !== document) return
    const range = selected.getRangeAt(0).cloneRange()
    let element = range.commonAncestorContainer
    if (element.nodeType !== 1) element = element.parentElement
    try { send(AnnotateInspector.capture(element, range)) } catch (error) { send(null, error.message) }
  }
  on(document, "selectionchange", () => { clearTimeout(timer); timer = setTimeout(selection, 160) })
  on(document, "pointerup", selection)
  on(document, "mousemove", event => {
    if (!picking) return
    const rect = event.target.getBoundingClientRect()
    box.style.cssText = `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`
  }, { capture: true })
  on(document, "pointerdown", event => { if (picking) { event.preventDefault(); event.stopImmediatePropagation() } }, { capture: true })
  on(document, "click", event => {
    if (!picking) return
    event.preventDefault(); event.stopImmediatePropagation()
    // A failed pick must never leave the page trapped in interception mode.
    setPicking(false, false)
    try { send(AnnotateInspector.capture(event.target)) } catch (error) { send(null, error.message) }
  }, { capture: true })
  on(document, "keydown", event => { if (picking && event.key === "Escape") setPicking(false) })
  const onMessage = (message, _sender, respond) => {
    if (message.action === "pick") { setPicking(!picking); respond({ ok: true, picking }) }
    if (message.action === "markers") { markers = message.notes || []; draw(); respond({ ok: true }) }
    if (message.action === "locate") respond({ states: message.anchors.map(locate) })
    if (message.action === "reveal") {
      const state = locate(message.anchor)
      if (state !== "located") {
        respond({ ok: false, error: `This element is ${state}. Your feedback is kept.` })
        return
      }
      setPicking(false)
      highlighted = document.querySelector(message.anchor.selector)
      highlighted.scrollIntoView({ block: "center", inline: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })
      root.append(highlight); draw()
      clearTimeout(highlightTimer)
      highlightTimer = setTimeout(() => { highlighted = null; highlight.remove() }, 1600)
      respond({ ok: true })
    }
  }
  chrome.runtime.onMessage.addListener(onMessage)
  function locate(anchor) {
    try {
      const matches = document.querySelectorAll(anchor.selector)
      if (matches.length !== 1) return matches.length ? "ambiguous" : "missing"
      const text = AnnotateInspector.text(matches[0])
      if (!text.includes(anchor.quote)) return "changed"
      if (anchor.type === "text" && text.split(anchor.quote).length > 2) {
        if (!text.includes(`${anchor.prefix || ""}${anchor.quote}${anchor.suffix || ""}`)) return "ambiguous"
      }
      return "located"
    } catch { return "invalid selector" }
  }
  function draw() {
    if (highlighted?.isConnected) {
      const rect = highlighted.getBoundingClientRect()
      highlight.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`
    } else highlight.remove()
    root.querySelectorAll(".pin").forEach(node => node.remove())
    for (const [index, note] of markers.entries()) {
      let matches
      try { matches = document.querySelectorAll(note.anchor.selector) } catch { continue }
      if (matches.length !== 1) continue
      const element = matches[0]
      // A changed or removed quote is an orphan, not another equally named element.
      if (!AnnotateInspector.text(element).includes(note.anchor.quote)) continue
      const rect = element.getBoundingClientRect()
      const pin = document.createElement("span"); pin.className = "pin"; pin.textContent = String(index + 1)
      pin.style.cssText = `left:${rect.left - 10}px;top:${rect.top - 10}px`; root.append(pin)
    }
  }
  on(document, "scroll", draw, { capture: true, passive: true }); on(window, "resize", draw)
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(draw, 160) })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  const routeTimer = setInterval(() => { if (!active) { observer.disconnect(); return } if (url !== location.href) { url = location.href; markers = []; draw(); send() } }, 700)
  function dispose() {
    if (!active) return
    active = false; listeners.abort(); clearInterval(routeTimer); clearTimeout(timer); clearTimeout(highlightTimer); observer.disconnect(); host.remove()
    try { chrome.runtime.onMessage.removeListener(onMessage) } catch { /* previous extension context may already be invalidated */ }
    delete globalThis.__opencodeAnnotate
  }
  globalThis.__opencodeAnnotate = { dispose }
  send()
})();
