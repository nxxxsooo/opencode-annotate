import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile, mkdtemp, rm, mkdir, writeFile, cp } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { pathToFileURL } from "node:url"
import os from "node:os"
import path from "node:path"
import { safariManifest, stageExtension, buildSettings, signingIdentity, APP_NAME, BUNDLE_ID } from "./build-safari.mjs"
import { PROTOCOL } from "../browser/protocol.mjs"

const text = file => readFile(new URL(`../${file}`, import.meta.url), "utf8")
test("Safari manifest derives shared fields and drops Chrome-only capabilities", async () => {
  const chrome = JSON.parse(await text("browser/manifest.json")), safari = safariManifest(chrome)
  for (const field of ["manifest_version", "name", "version", "description", "icons", "action", "commands"]) assert.deepEqual(safari[field], chrome[field])
  assert.equal(safari.side_panel, undefined)
  assert.equal(safari.key, undefined)
  assert.ok(!safari.permissions.includes("sidePanel"))
  assert.ok(!safari.permissions.includes("nativeMessaging"))
  assert.ok(safari.permissions.includes("activeTab"))
  assert.deepEqual(safari.background, { page: "background.html" })
  assert.deepEqual(safari.browser_specific_settings, { safari: { strict_min_version: "18.0" } })
  assert.equal(chrome.background.service_worker, "worker.mjs")
})
test("staged Safari resources retain shared worker imports and module background", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "oa-safari-stage-"))
  try {
    await stageExtension(path.join(directory, "extension"))
    assert.match(await readFile(path.join(directory, "extension/background.html"), "utf8"), /<script type="module" src="worker\.mjs">/)
    assert.match(await readFile(path.join(directory, "extension/worker.mjs"), "utf8"), /from "\.\/env\.mjs"/)
    assert.ok(await readFile(path.join(directory, "extension/env.mjs"), "utf8"))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test("Safari bundle settings stamp the supplied package version and require sandbox", () => {
  const settings = buildSettings({ version: "7.8.9", identity: "Developer ID Application", team: "TEAM" })
  assert.equal(settings.MARKETING_VERSION, "7.8.9")
  assert.equal(settings.CURRENT_PROJECT_VERSION, "7.8.9")
  assert.equal(settings.ENABLE_APP_SANDBOX, "YES")
  assert.equal(settings.CODE_SIGN_IDENTITY, "Developer ID Application")
  assert.equal(settings.CODE_SIGN_STYLE, "Manual")
  assert.equal(settings.DEVELOPMENT_TEAM, "TEAM")
  assert.throws(() => buildSettings(), /package version/)
})
test("Safari build reads its version from root package.json", async () => {
  const source = await text("scripts/build-safari.mjs")
  assert.match(source, /const \{ version \} = JSON\.parse\(await readFile\(path\.join\(root, "package\.json"\)/)
  assert.match(source, /buildSettings\(\{ version,/)
})
test("a nondefault package version reaches both Xcode bundle version overrides", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "oa-safari-version-"))
  try {
    await mkdir(path.join(directory, "scripts"))
    await mkdir(path.join(directory, "bin"))
    await cp(new URL("./build-safari.mjs", import.meta.url), path.join(directory, "scripts/build-safari.mjs"))
    await cp(new URL("../browser", import.meta.url), path.join(directory, "browser"), { recursive: true })
    await cp(new URL("../safari", import.meta.url), path.join(directory, "safari"), { recursive: true })
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ version: "7.8.9" }))
    // Stub build tools only: no real converter, signing, app installation or GUI.
    const shim = `#!${process.execPath}
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
const args = process.argv.slice(2)
if (process.argv[1].endsWith("xcrun")) {
  const generated = path.join(args[args.indexOf("--project-location") + 1], "annotate", "annotate Extension")
  await mkdir(generated, { recursive: true })
  await writeFile(path.join(generated, "SafariWebExtensionHandler.swift"), "placeholder")
} else {
  await writeFile(process.env.BUILD_ARGS, JSON.stringify(args))
  await mkdir(path.join(args[args.indexOf("-derivedDataPath") + 1], "Build/Products/Release/annotate.app"), { recursive: true })
}
`
    for (const name of ["xcrun", "xcodebuild"]) await writeFile(path.join(directory, "bin", name), shim, { mode: 0o755 })
    const record = path.join(directory, "args.json")
    const script = pathToFileURL(path.join(directory, "scripts/build-safari.mjs")).href
    await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `import { buildApp } from ${JSON.stringify(script)}; await buildApp()`], {
      env: { ...process.env, PATH: `${path.join(directory, "bin")}:${process.env.PATH}`, BUILD_ARGS: record },
    })
    const args = JSON.parse(await readFile(record, "utf8"))
    assert.ok(args.includes("MARKETING_VERSION=7.8.9"))
    assert.ok(args.includes("CURRENT_PROJECT_VERSION=7.8.9"))
    assert.ok(args.includes("ENABLE_APP_SANDBOX=YES"))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test("Safari signing, identity and inert native handler", async () => {
  assert.deepEqual(signingIdentity({}), { identity: "-", team: "" })
  assert.deepEqual(signingIdentity({ team: "TEAM" }), { identity: "Apple Development", team: "TEAM" })
  assert.deepEqual(signingIdentity({ identity: "ID", team: "TEAM" }), { identity: "ID", team: "TEAM" })
  assert.equal(APP_NAME, "annotate")
  assert.equal(BUNDLE_ID, "fun.mjshao.annotate")
  const swift = await text("safari/SafariWebExtensionHandler.swift")
  assert.match(swift, /SFExtensionMessageKey/)
  assert.match(swift, /completeRequest\(returningItems:/)
  assert.doesNotMatch(swift, /Process\(|homeDirectoryForCurrentUser|\.local\/share/)
  assert.equal(PROTOCOL, 8)
})
test("npm allowlist includes Safari sources and imported runtime browser opener", async () => {
  const pkg = JSON.parse(await text("package.json"))
  for (const file of ["scripts/browser-target.mjs", "scripts/build-safari.mjs", "scripts/install-safari.mjs", "safari/background.html", "safari/SafariWebExtensionHandler.swift"]) assert.ok(pkg.files.includes(file), file)
  assert.ok(!pkg.files.includes("safari"))
})
