import { spawn } from "node:child_process"
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

async function execute(binary, args, { signal }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "annotate-session-api-"))
  const filename = path.join(directory, "response.json")
  try {
    // OpenCode 2.2 exits before a pipe drains past 256 KiB. A regular output file
    // avoids truncated JSON; it stays private and is removed after every read.
    const output = await open(filename, "wx", 0o600)
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(binary, args, { signal, timeout: 30000, stdio: ["ignore", output.fd, "pipe"] })
        let errorText = ""
        child.stderr.on("data", chunk => { errorText = (errorText + chunk).slice(-16000) })
        child.once("error", reject)
        child.once("close", (code, termination) => {
          if (code === 0) resolve()
          else reject(new Error(`OpenCode history request failed (${termination ?? code}): ${errorText.trim()}`))
        })
      })
    } finally {
      await output.close()
    }
    signal?.throwIfAborted()
    if ((await stat(filename)).size > 32 * 1024 * 1024) throw new Error("History page exceeds 32 MiB. Read a specific message instead.")
    return { stdout: await readFile(filename, "utf8") }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

// V2.2's plugin context lacks message.list/get; session.context loses pre-compaction
// history. The official CLI supplies authenticated HTTP access without reading the DB.
// Fail closed for standalone/embedded servers rather than discovering another server.
export async function serverHistoryClient(context, signal, { run = execute, processID = process.pid } = {}) {
  async function get(route, request = {}) {
    const { stdout } = await run("opencode", ["api", "get", route, "--header", "Accept-Encoding:identity"], {
      signal: request.signal ?? signal,
    })
    return JSON.parse(stdout)
  }
  const server = await get("/api/info")
  if (server.pid !== processID) {
    throw new Error("Full-history tools require this plugin to run in the managed OpenCode service. The discovered server is a different process; use /ref in the connected TUI instead.")
  }
  return {
    session: {
      get: (input, options) => context.session.get(input, options),
      message: { get: async ({ sessionID, messageID }, options) =>
        (await get(`/api/session/${encodeURIComponent(sessionID)}/message/${encodeURIComponent(messageID)}`, options)).data },
    },
    message: { list: ({ sessionID, ...query }, options) =>
      get(`/api/session/${encodeURIComponent(sessionID)}/message?${new URLSearchParams(query)}`, options) },
  }
}
