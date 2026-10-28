import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { randomUUID } from "node:crypto"
import { createAgyReceiver, getAgySessionTitle } from "./receiver.mjs"
import { listPendingBatches } from "./inbox.mjs"
import { listTargets } from "../bridge/receiver.mjs"
import { request } from "../bridge/wire.mjs"

const sampleReview = () => ({
  version: 1,
  page: { url: "https://example.test/app", title: "App Preview" },
  annotations: [
    {
      id: "note-1",
      revision: 1,
      kind: "comment",
      comment: "Improve spacing on the header",
      createdAt: new Date().toISOString(),
      anchor: { type: "element", quote: "Header text", selector: "header > h1" },
    },
  ],
})

async function makeFixture(t) {
  const base = path.join(os.homedir(), ".cache")
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(path.join(base, "agy-recv-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const targetDir = path.join(root, "targets")
  const inboxDir = path.join(root, "inbox")
  await mkdir(targetDir, { recursive: true })
  await mkdir(inboxDir, { recursive: true })
  return { root, targetDir, inboxDir }
}

test("createAgyReceiver registers target as provider: agy and enqueues to inbox", async t => {
  const { targetDir, inboxDir } = await makeFixture(t)
  const conversationId = "conv-abc-123"

  const receiver = await createAgyReceiver({
    conversationId,
    title: "Fixture AGY Conversation",
    directory: "/workspace/my-app",
    root: targetDir,
    inboxRoot: inboxDir,
  })
  t.after(() => receiver.close())

  const targets = await listTargets(targetDir)
  assert.equal(targets.length, 1)
  assert.equal(targets[0].provider, "agy")
  assert.equal(targets[0].sessionID, conversationId)
  assert.equal(targets[0].title, "Fixture AGY Conversation")

  const batchID = randomUUID()
  const res = await request(receiver.target.socket, {
    action: "send",
    targetID: receiver.target.id,
    batchID,
    review: sampleReview(),
  })

  assert.equal(res.ok, true)
  assert.equal(res.state, "admitted")

  const pending = await listPendingBatches(conversationId, inboxDir)
  assert.equal(pending.length, 1)
  assert.equal(pending[0].batchID, batchID)
  assert.ok(pending[0].markdown.includes("Improve spacing on the header"))
})
