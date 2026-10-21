import { readFile, writeFile, mkdir, realpath, rename, stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import path from "node:path"
import os from "node:os"

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "")
const source = entry => typeof entry === "string" ? entry : entry.package
const oldEntry = entry => source(entry) === "opencode-plannotator-tui" || source(entry)?.startsWith("opencode-plannotator-tui@")
const configPath = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode/cli.json")
const filename = await realpath(configPath)
const bytes = await readFile(filename, "utf8"), config = JSON.parse(bytes)
let backup
if (process.argv[2] === "--undo") {
  if (!process.argv[3]) throw new Error("Supply the cli-before.json backup")
  const previous = JSON.parse(await readFile(process.argv[3], "utf8"))
  const old = previous.plugins.filter(oldEntry)
  if (old.length !== 1 || config.plugins.filter(entry => source(entry) === root).length !== 1) throw new Error("Ambiguous plugin rollback; no changes made")
  config.plugins = config.plugins.map(entry => source(entry) === root ? old[0] : entry)
} else {
  const candidates = config.plugins.filter(oldEntry)
  if (config.plugins.some(entry => source(entry) === root)) { console.log("Local plugin is already configured."); process.exit(0) }
  if (candidates.length !== 1) throw new Error("Expected exactly one existing Plannotator TUI entry; no changes made")
  const backupDir = path.join(root, ".local/migration")
  await mkdir(backupDir, { recursive: true, mode: 0o700 })
  backup = path.join(backupDir, `cli-before-${Date.now()}.json`)
  await writeFile(backup, bytes, { mode: 0o600, flag: "wx" })
  config.plugins = config.plugins.map(entry => oldEntry(entry) ? typeof entry === "string" ? root : { ...entry, package: root } : entry)
}
if (await readFile(filename, "utf8") !== bytes) throw new Error("CLI configuration changed concurrently; retry")
const output = `${JSON.stringify(config, null, 2)}\n`, temporary = `${filename}.annotate-${process.pid}`
await writeFile(temporary, output, { mode: (await stat(filename)).mode & 0o777, flag: "wx" })
await rename(temporary, filename)
console.log(JSON.stringify({ configured: root, config: filename, backup, installedSha256: createHash("sha256").update(output).digest("hex"), next: "Reopen the OpenCode terminal client. Do not restart the shared service." }, null, 2))
