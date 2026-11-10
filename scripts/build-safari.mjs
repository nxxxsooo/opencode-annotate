// Derive a Safari app from the shared browser sources; Chrome stays the source
// of truth. Apple's converter generates the Xcode project, not checked-in sources.
import { spawn } from "node:child_process"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const project = path.join(root, "safari")
const browser = path.join(root, "browser")
const build = path.join(root, ".local", "safari")
export const APP_NAME = "annotate"
export const BUNDLE_ID = "fun.mjshao.annotate"

export function safariManifest(chromeManifest) {
  const manifest = structuredClone(chromeManifest)
  delete manifest.side_panel
  delete manifest.key
  // Safari requires a sandboxed extension; it cannot reach the Node bridge.
  manifest.permissions = manifest.permissions.filter(permission => permission !== "sidePanel" && permission !== "nativeMessaging")
  manifest.background = { page: "background.html" }
  manifest.browser_specific_settings = { safari: { strict_min_version: "18.0" } }
  return manifest
}
export async function stageExtension(directory) {
  await rm(directory, { recursive: true, force: true })
  await cp(browser, directory, { recursive: true })
  const manifest = safariManifest(JSON.parse(await readFile(path.join(browser, "manifest.json"), "utf8")))
  await writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  await cp(path.join(project, "background.html"), path.join(directory, "background.html"))
  return directory
}
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options })
    child.once("error", reject)
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)))
  })
}
export async function convert(directory, projectDirectory) {
  await rm(projectDirectory, { recursive: true, force: true })
  await run("xcrun", ["safari-web-extension-converter", directory,
    "--project-location", projectDirectory, "--app-name", APP_NAME,
    "--bundle-identifier", BUNDLE_ID,
    "--macos-only", "--swift", "--no-open", "--no-prompt", "--force", "--copy-resources"])
  const generated = path.join(projectDirectory, APP_NAME, `${APP_NAME} Extension`, "SafariWebExtensionHandler.swift")
  if (!existsSync(generated)) throw new Error(`The converter did not produce ${generated}`)
  await cp(path.join(project, "SafariWebExtensionHandler.swift"), generated)
  return path.join(projectDirectory, APP_NAME, `${APP_NAME}.xcodeproj`)
}
// Safari refuses to register an unsandboxed extension. This is copy-only.
export function buildSettings({ version, identity = "Apple Development", team = "", configuration = "Release" } = {}) {
  if (!version) throw new Error("A package version is required for the Safari bundle")
  return {
    CODE_SIGN_IDENTITY: identity,
    CODE_SIGN_STYLE: team ? "Manual" : "Automatic",
    ...(team ? { DEVELOPMENT_TEAM: team } : {}),
    ENABLE_APP_SANDBOX: "YES",
    ENABLE_HARDENED_RUNTIME: "YES",
    MARKETING_VERSION: version,
    CURRENT_PROJECT_VERSION: version,
    CONFIGURATION: configuration,
  }
}
export function signingIdentity({ identity, team } = {}) {
  if (identity) return { identity, team }
  if (team) return { identity: "Apple Development", team }
  return { identity: "-", team: "" }
}
export async function buildApp({ identity, team, configuration = "Release", derivedData = build } = {}) {
  const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
  const directory = await mkdtemp(path.join(os.tmpdir(), "oa-safari-"))
  try {
    const staged = await stageExtension(path.join(directory, "extension"))
    const xcodeproj = await convert(staged, path.join(directory, "project"))
    await mkdir(derivedData, { recursive: true })
    const settings = buildSettings({ version, ...signingIdentity({ identity, team }), configuration })
    const overrides = Object.entries(settings).map(([key, value]) => `${key}=${value}`)
    await run("xcodebuild", ["-project", xcodeproj, "-scheme", APP_NAME, "-configuration", configuration,
      "-destination", "platform=macOS", "-derivedDataPath", derivedData, ...overrides, "build"])
    const app = path.join(derivedData, "Build", "Products", configuration, `${APP_NAME}.app`)
    if (!existsSync(app)) throw new Error(`The build did not produce ${app}`)
    return app
  } finally { await rm(directory, { recursive: true, force: true }) }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const identity = process.env.ANNOTATE_SIGN_IDENTITY || undefined
  const team = process.env.ANNOTATE_DEVELOPMENT_TEAM || undefined
  console.log(`Built ${await buildApp({ identity, team })}`)
  if (!identity) {
    console.log("Warning: this app is ad-hoc signed. Safari may refuse to register it.")
    console.log("Set ANNOTATE_SIGN_IDENTITY and ANNOTATE_DEVELOPMENT_TEAM to a local Apple Development identity.")
  }
  console.log("Install it with npm run install:safari, open it once, then enable Annotate in Safari > Settings > Extensions.")
}
