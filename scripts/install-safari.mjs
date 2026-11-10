// Replace the installed Safari app and refresh its app-extension registration.
import { cp, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import path from "node:path"

const execute = promisify(execFile)
const root = fileURLToPath(new URL("../", import.meta.url))
const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
export async function installSafari({ source = path.join(root, ".local/safari/Build/Products/Release/annotate.app"), target = "/Applications/annotate.app" } = {}) {
  if (typeof source !== "string" || !source.trim()) throw new Error("Safari app source must be a nonempty path")
  if (typeof target !== "string" || !path.isAbsolute(target) || !path.basename(path.normalize(target)).endsWith(".app") || path.basename(path.normalize(target)) === ".app") {
    throw new Error("Safari install target must be an absolute .app bundle path")
  }
  source = path.resolve(source); target = path.normalize(target)
  if (source === target || source.startsWith(`${target}${path.sep}`)) throw new Error("Safari app source must be outside the install target")
  if (!existsSync(source)) throw new Error(`Build the app first: npm run build:safari (missing ${source})`)
  const appex = path.join(target, "Contents/PlugIns/annotate Extension.appex")
  await rm(target, { recursive: true, force: true })
  await cp(source, target, { recursive: true })
  await execute(lsregister, ["-f", target])
  await execute("pluginkit", ["-r", appex]).catch(() => {})
  await execute("pluginkit", ["-a", appex])
  return { target, appex }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { target } = await installSafari()
  console.log(`Installed ${target}`)
  console.log("Open it once, then enable Annotate in Safari > Settings > Extensions.")
}
