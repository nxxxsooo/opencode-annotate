import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { extractAgyReplies, latestCompletedReply, cleanModelContent } from "./transcript.mjs"

async function makeFixture(t) {
  const base = path.join(os.homedir(), ".cache")
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(path.join(base, "agy-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const logDir = path.join(root, ".system_generated/logs")
  await mkdir(logDir, { recursive: true })
  return { root, logDir }
}

test("extractAgyReplies extracts completed and in-progress replies, handling truncated fields", async t => {
  const { root, logDir } = await makeFixture(t)
  const logPath = path.join(logDir, "transcript.jsonl")
  const fullLogPath = path.join(logDir, "transcript_full.jsonl")

  const step0 = { step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", content: "Build a feature" }
  const step1 = {
    step_index: 1,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: "2026-10-28T10:00:00Z",
    content: "Checking the codebase...",
    tool_calls: [{ name: "run_command" }],
  }
  const step2 = {
    step_index: 2,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: "2026-10-28T10:01:00Z",
    content: "Truncated preview...",
    truncated_fields: ["content"],
    tool_calls: [],
  }
  const step2Full = {
    step_index: 2,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: "2026-10-28T10:01:00Z",
    content: "Full complete response with <hindsight_knowledge_refresh>tags to strip</hindsight_knowledge_refresh> and actual advice.",
    tool_calls: [],
  }

  await writeFile(logPath, [JSON.stringify(step0), JSON.stringify(step1), JSON.stringify(step2)].join("\n"))
  await writeFile(fullLogPath, JSON.stringify(step2Full))

  const replies = await extractAgyReplies(root)
  assert.equal(replies.length, 2)

  // Newest first
  assert.equal(replies[0].id, "2")
  assert.equal(replies[0].progress, false)
  assert.equal(replies[0].text, "Full complete response with  and actual advice.")

  assert.equal(replies[1].id, "1")
  assert.equal(replies[1].progress, true)
  assert.equal(replies[1].text, "Checking the codebase...")

  const latest = latestCompletedReply(replies)
  assert.ok(latest)
  assert.equal(latest.id, "2")
})

test("extractAgyReplies returns empty array when transcript does not exist", async () => {
  const replies = await extractAgyReplies("/non/existent/path")
  assert.deepEqual(replies, [])
})
