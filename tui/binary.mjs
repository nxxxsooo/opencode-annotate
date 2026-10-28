import { fileURLToPath } from "node:url"

export const platforms = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
}

export function bundledBinary(platform = `${process.platform}-${process.arch}`) {
  if (!platforms[platform]) throw new Error(`Annotate TUI has no bundled executable for ${platform}. Set the binary option to a local build.`)
  const extension = platform.startsWith("win32-") ? ".exe" : ""
  return fileURLToPath(new URL(`./bin/${platform}/annotate-tui${extension}`, import.meta.url))
}

export function resolveTuiBinary(customBinary) {
  return customBinary ?? bundledBinary()
}
