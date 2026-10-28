import { spawnSync } from "node:child_process"
import { chmod, copyFile, mkdir, readFile, rename } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { bundledBinary, platforms } from "../tui/binary.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const platform = process.argv[2] ?? `${process.platform}-${process.arch}`
const target = platforms[platform]
if (!target) throw new Error(`Unknown build platform: ${platform}`)
const manifest = path.join(root, "tui/Cargo.toml")
const version = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version
const cargo = await readFile(manifest, "utf8")
if (!cargo.includes(`version = "${version}"`)) throw new Error("Keep package.json and tui/Cargo.toml versions in sync before building.")
const args = ["build", "--release", "--locked", "--manifest-path", manifest]
// Native builds need only the installed toolchain; cross builds require this Rust target.
const cross = platform !== `${process.platform}-${process.arch}`
if (cross) args.push("--target", target)
const result = spawnSync("cargo", args, { cwd: root, stdio: "inherit" })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
const executable = `annotate-tui${platform.startsWith("win32-") ? ".exe" : ""}`
const targetDir = process.env.CARGO_TARGET_DIR ? path.resolve(root, process.env.CARGO_TARGET_DIR) : path.join(root, "tui/target")
const built = path.join(targetDir, ...(cross ? [target] : []), "release", executable)
const installed = bundledBinary(platform)
await mkdir(path.dirname(installed), { recursive: true })
const temporary = `${installed}.${process.pid}`
await copyFile(built, temporary)
await chmod(temporary, 0o755)
await rename(temporary, installed)
console.log(`Built ${platform}: ${installed}`)
