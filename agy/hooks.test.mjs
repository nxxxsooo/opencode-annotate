import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { handlePreInvocation, handleStop, handleSessionStart } from "./hooks.mjs"
import { enqueueAnnotations } from "./inbox.mjs"

async function makeFixture(t) {
  const base = path.join(os.homedir(), ".cache")
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(path.join(base, "hooks-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const inboxRoot = path.join(root, "inbox")
  const targetRoot = path.join(root, "targets")
  await mkdir(inboxRoot, { recursive: true })
  await mkdir(targetRoot, { recursive: true })
  return { root, inboxRoot, targetRoot }
}

test("handlePreInvocation injects userMessage when inbox has pending annotations", async t => {
  const { inboxRoot } = await makeFixture(t)
  const conversationId = "conv-test-hook"

  // Empty inbox returns empty object
  const emptyRes = await handlePreInvocation({ conversationId }, { inboxRoot })
  assert.deepEqual(emptyRes, {})

  // Enqueue annotations
  await enqueueAnnotations(conversationId, { batchID: "b-1", markdown: "Fix the navbar button" }, inboxRoot)

  const res = await handlePreInvocation({ conversationId }, { inboxRoot })
  assert.ok(res.injectSteps)
  assert.equal(res.injectSteps.length, 1)
  assert.ok(res.injectSteps[0].userMessage.includes("Fix the navbar button"))

  // Subsequent call finds inbox empty
  const drained = await handlePreInvocation({ conversationId }, { inboxRoot })
  assert.deepEqual(drained, {})
})

test("handleStop forces continuation when inbox has pending annotations", async t => {
  const { inboxRoot } = await makeFixture(t)
  const conversationId = "conv-test-stop"

  // Empty inbox returns empty object
  const emptyRes = await handleStop({ conversationId }, { inboxRoot })
  assert.deepEqual(emptyRes, {})

  // Enqueue annotations
  await enqueueAnnotations(conversationId, { batchID: "b-stop", markdown: "Check accessibility labels" }, inboxRoot)

  const res = await handleStop({ conversationId }, { inboxRoot })
  assert.equal(res.decision, "continue")
  assert.ok(res.reason.includes("Check accessibility labels"))

  // Second call is empty
  const drained = await handleStop({ conversationId }, { inboxRoot })
  assert.deepEqual(drained, {})
})
