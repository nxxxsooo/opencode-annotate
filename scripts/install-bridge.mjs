import { readFile, mkdir, writeFile, chmod, copyFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import os from "node:os"
import path from "node:path"
import { registryRoot } from "../bridge/receiver.mjs"
const root = fileURLToPath(new URL("../", import.meta.url))
export async function installBridge({ profileDirectory = path.join(os.homedir(), "Library/Application Support/Google/Chrome"), installRoot = path.join(os.homedir(), ".local/share/opencode-annotate/native"), node = process.execPath, targetsDirectory = registryRoot() } = {}) {
  const manifest = JSON.parse(await readFile(path.join(root, "browser/manifest.json"), "utf8"))
  const extensionID = [...createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest().subarray(0, 16)].flatMap(byte => [String.fromCharCode(97 + (byte >> 4)), String.fromCharCode(97 + (byte & 15))]).join("")
  await mkdir(installRoot, { recursive: true, mode: 0o700 })
  const launcher = path.join(installRoot, "host"), config = path.join(installRoot, "config.json")
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`
  await writeFile(config, JSON.stringify({ extensionID, targetsDirectory }), { mode: 0o600 })
  await writeFile(launcher, `#!/bin/sh\nexec ${quote(node)} ${quote(path.join(root, "bridge/native-host.mjs"))} ${quote(config)} "$@"\n`, { mode: 0o700 })
  await chmod(launcher, 0o700)
  const directory = path.join(profileDirectory, "NativeMessagingHosts")
  await mkdir(directory, { recursive: true })
  const hostManifest = path.join(directory, "fun.mjshao.annotate.json")
  try { await copyFile(hostManifest, `${hostManifest}.backup-${Date.now()}`) } catch (error) { if (error.code !== "ENOENT") throw error }
  await writeFile(hostManifest, JSON.stringify({ name: "fun.mjshao.annotate", description: "Paired OpenCode annotation delivery", path: launcher, type: "stdio", allowed_origins: [`chrome-extension://${extensionID}/`] }, null, 2), { mode: 0o600 })
  return { extensionID, extensionDirectory: path.join(root, "browser"), hostManifest, launcher }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.platform !== "darwin") throw new Error("Local installer currently supports macOS only")
  console.log(JSON.stringify(await installBridge(), null, 2))
}
