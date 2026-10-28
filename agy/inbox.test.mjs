import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { enqueueAnnotations, listPendingBatches, dequeueAnnotations } from "./inbox.mjs"

async function makeFixture(t) {
  const base = path.join(os.homedir(), ".cache")
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(path.join(base, "inbox-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test("inbox enqueues, lists, and dequeues batches atomically", async t => {
  const root = await makeFixture(t)
  const conversationId = "conv-123"

  assert.equal(await dequeueAnnotations(conversationId, root), null)
  assert.deepEqual(await listPendingBatches(conversationId, root), [])

  await enqueueAnnotations(conversationId, { batchID: "b-1", markdown: "# Note 1", promptID: "p-1" }, root)
  await enqueueAnnotations(conversationId, { batchID: "b-2", markdown: "# Note 2", promptID: "p-2" }, root)

  const pending = await listPendingBatches(conversationId, root)
  assert.equal(pending.length, 2)
  assert.equal(pending[0].batchID, "b-1")
  assert.equal(pending[1].batchID, "b-2")

  const dequeued = await dequeueAnnotations(conversationId, root)
  assert.ok(dequeued)
  assert.equal(dequeued.count, 2)
  assert.deepEqual(dequeued.batchIDs, ["b-1", "b-2"])
  assert.ok(dequeued.combinedMarkdown.includes("# Note 1"))
  assert.ok(dequeued.combinedMarkdown.includes("# Note 2"))

  // Subsequent dequeue is empty
  assert.equal(await dequeueAnnotations(conversationId, root), null)
})
