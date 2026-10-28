import assert from "node:assert/strict"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { serverHistoryClient } from "./server-history.mjs"

test("history transport captures large output privately and cleans up after success and failure", { skip: process.platform === "win32" }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "annotate-history-test-"))
  const previous = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR }
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  })
  await writeFile(path.join(root, "opencode"), `#!${process.execPath}
const { fstatSync, writeFileSync } = require("node:fs")
const route = process.argv[4]
if (!fstatSync(1).isFile() || (fstatSync(1).mode & 0o077)) process.exit(2)
if (route === "/api/info") writeFileSync(1, JSON.stringify({ pid: 42 }))
else if (route.includes("missing")) { process.stderr.write("Missing session"); process.exitCode = 1 }
else writeFileSync(1, JSON.stringify({ data: [{ text: "x".repeat(300000) }], cursor: {} }))
`, { mode: 0o700 })
  process.env.PATH = root
  process.env.TMPDIR = root
  const client = await serverHistoryClient({}, undefined, { processID: 42 })
  const result = await client.message.list({ sessionID: "ses_large", limit: 50 })
  assert.equal(result.data[0].text.length, 300000)
  assert.deepEqual(await readdir(root), ["opencode"])
  await assert.rejects(client.message.list({ sessionID: "ses_missing", limit: 50 }), /Missing session/)
  assert.deepEqual(await readdir(root), ["opencode"])
  await assert.rejects(serverHistoryClient({}, AbortSignal.abort(), { processID: 42 }), { name: "AbortError" })
  assert.deepEqual(await readdir(root), ["opencode"])
})
