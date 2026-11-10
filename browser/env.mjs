// Shared engine differences. Safari uses an independent, copy-only panel window;
// only Chrome reaches the local native messaging bridge.
export function extensionScheme() {
  try { return new URL(chrome.runtime.getURL("/")).protocol.replace(/:$/, "") } catch { return "" }
}
export const isSafari = () => extensionScheme() === "safari-web-extension"
export const isChrome = () => extensionScheme() === "chrome-extension"

// Safari extension UUIDs can differ in case between APIs.
export function sameExtensionURL(url) {
  if (!url) return false
  try {
    const candidate = new URL(url), own = new URL(chrome.runtime.getURL("/"))
    return candidate.protocol === own.protocol && candidate.host.toLowerCase() === own.host.toLowerCase()
  } catch { return false }
}
export function panelWindowID() {
  if (typeof location === "undefined") return undefined
  const raw = new URLSearchParams(location.search).get("window")
  if (raw === null) return undefined
  const id = Number(raw)
  return Number.isInteger(id) && id >= 0 ? id : undefined
}
export async function openPanel(tab) {
  if (!isSafari()) return chrome.sidePanel.open({ tabId: tab.id })
  const url = new URL(chrome.runtime.getURL("panel.html"))
  url.searchParams.set("window", String(tab.windowId))
  try { return await chrome.windows.create({ url: url.href, type: "popup", width: 420, height: 860 }) }
  catch (error) { throw new Error(`Could not open the Safari annotation window: ${error.message}`) }
}
// Bind the Safari popup to the reviewed browser window, not its own focused window.
export async function resolveTargetTab(message) {
  const windowID = message?.windowID
  if (Number.isInteger(windowID) && windowID >= 0) {
    const [tab] = await chrome.tabs.query({ active: true, windowId: windowID })
    if (!tab) throw new Error("No active page")
    return tab
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab) throw new Error("No active page")
  return tab
}
export function panelPolling() {
  return isSafari() || document.visibilityState === "visible"
}
// Safari requires an App-Sandboxed extension, which cannot reach the Node bridge.
export function sessionDelivery() {
  return !isSafari()
}
export function reconnectHint() {
  return isSafari()
    ? "This page reloaded. Click the Annotate toolbar button once to reconnect it; your notes are kept."
    : "This page reloaded. Click the Annotate icon (Alt+Shift+A) once to reconnect it; your notes are kept."
}
