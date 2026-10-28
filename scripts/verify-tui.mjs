import { execFileSync } from "node:child_process"
import { access, readFile, stat } from "node:fs/promises"
import { constants } from "node:fs"
import { bundledBinary, platforms } from "../tui/binary.mjs"

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
const selected = process.argv.includes("--all") ? Object.keys(platforms) : [`${process.platform}-${process.arch}`]
for (const platform of selected) {
  const binary = bundledBinary(platform)
  await access(binary, constants.X_OK)
  if (!(await stat(binary)).isFile()) throw new Error(`Not a regular executable: ${binary}`)
}
const actual = execFileSync(bundledBinary(), ["--version"], { encoding: "utf8" }).trim()
if (actual !== `annotate-tui ${version}`) throw new Error(`TUI version mismatch: ${actual}, expected ${version}. Run npm run build:tui.`)
await access(new URL("../tui/LICENSE", import.meta.url))
console.log(`Verified Annotate TUI ${version}: ${selected.join(", ")}`)
