import { stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const unquote = input => {
  const value = input.trim()
  return ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) ? value.slice(1, -1) : value
}
export const wantsBrowser = input => /^web(?: off)?$/.test(unquote(input)) || /\.html?$/i.test(unquote(input)) || /^[a-z][a-z0-9+.-]*:/i.test(unquote(input))

export async function browserTarget(input, directory) {
  let value = unquote(input)
  if (value === "web") return { type: "browser" }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    const url = new URL(value)
    if (["http:", "https:"].includes(url.protocol)) {
      if (url.username || url.password) throw new Error("Remove credentials from the page URL.")
      if (/^chrome(webstore)?\.google\.com$/.test(url.hostname) || /\.pdf$/i.test(url.pathname)) throw new Error("This page cannot be annotated.")
      return { type: "browser", url: url.href }
    }
    if (url.protocol !== "file:") throw new Error("Use an http, https, or local HTML target.")
    value = fileURLToPath(url)
    if (!/\.html?$/i.test(value)) throw new Error("File URLs must point to an HTML document.")
  }
  if (!/\.html?$/i.test(value)) return null
  if (value.startsWith("~/")) value = path.join(os.homedir(), value.slice(2))
  if (!path.isAbsolute(value) && !directory) throw new Error("Can't determine the session working directory.")
  const file = path.resolve(directory || ".", value)
  if (!(await stat(file)).isFile()) throw new Error("The HTML target is not a file.")
  return { type: "browser", url: pathToFileURL(file).href }
}
