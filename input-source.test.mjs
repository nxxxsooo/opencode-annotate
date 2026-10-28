import assert from "node:assert/strict"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { createAsciiHold, createInputSource } from "./input-source.mjs"

test("a disabled or failing helper never switches and never throws", async t => {
  const disabled = createInputSource(false)
  assert.equal(disabled.command, undefined)
  assert.equal(await disabled.ascii(), undefined)
  const missing = createInputSource(path.join(os.tmpdir(), "no-such-slash-saver"))
  assert.equal(await missing.ascii(), undefined)
  assert.equal(await missing.select("com.apple.keylayout.US"), undefined)
})

test("the helper is called with Slash Saver's input-source verbs", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "input-source-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const log = path.join(root, "calls")
  const helper = path.join(root, "helper")
  await writeFile(helper, `#!/bin/sh\necho "$*" >> "${log}"\n[ "$2" = ascii ] && echo com.example.pinyin\nexit 0\n`)
  await chmod(helper, 0o755)
  const source = createInputSource(helper)
  assert.equal(await source.ascii(), "com.example.pinyin")
  await source.select("com.example.pinyin")
  await source.select(undefined)
  assert.equal(await readFile(log, "utf8"), "input-source ascii\ninput-source select com.example.pinyin\n")
})

test("overlapping prompts switch once and restore after the last one closes", async () => {
  const calls = []
  const hold = createAsciiHold({
    ascii: async () => (calls.push("ascii"), "com.example.pinyin"),
    select: async id => { calls.push(`select ${id}`) },
  })
  hold.enter("a")
  hold.enter("b")
  hold.enter("a")
  hold.leave("a")
  hold.leave("unknown")
  await hold.leave("b")
  assert.deepEqual(calls, ["ascii", "select com.example.pinyin"])
})
