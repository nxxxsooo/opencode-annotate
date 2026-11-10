// Open the reviewed page in the browser hosting its companion. Safari is copy-only;
// Chrome retains native messaging delivery.
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execute = promisify(execFile)
export const SAFARI_APP = "Safari"
export const CHROME_APP = "Google Chrome"
export function browserApp(options = {}) {
  const browser = options.browser
  if (browser === undefined || browser === "Chrome") return CHROME_APP
  if (browser === "Safari") return SAFARI_APP
  throw new Error('browser must be "Chrome" or "Safari".')
}
export async function openInBrowser(url, options = {}) {
  if (process.platform !== "darwin") throw new Error("Browser review currently requires macOS")
  await execute("open", ["-a", browserApp(options), url])
}
