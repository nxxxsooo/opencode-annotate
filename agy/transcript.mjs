import { readFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"

export const defaultBrainDir = (conversationId, baseDir = path.join(os.homedir(), ".gemini/antigravity-cli/brain")) =>
  path.join(baseDir, conversationId)

export function parseTranscriptLine(raw) {
  if (!raw || !raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function cleanModelContent(content) {
  if (!content) return ""
  // Strip transient system injections or tags that shouldn't be the subject of review
  return content.replace(/<hindsight_[^>]*>[\s\S]*?<\/hindsight_[^>]*>/g, "").trim()
}

export async function readFullStep(brainDir, stepIndex) {
  const fullLog = path.join(brainDir, ".system_generated/logs/transcript_full.jsonl")
  try {
    const text = await readFile(fullLog, "utf8")
    const lines = text.split("\n")
    for (const line of lines) {
      const parsed = parseTranscriptLine(line)
      if (parsed && parsed.step_index === stepIndex) return parsed
    }
  } catch {
    // Fall back if full transcript is absent
  }
  return null
}

export async function extractAgyReplies(brainDir, { signal } = {}) {
  const logPath = path.join(brainDir, ".system_generated/logs/transcript.jsonl")
  let text
  try {
    text = await readFile(logPath, "utf8", { signal })
  } catch (error) {
    if (error.code === "ENOENT") return []
    throw error
  }

  const lines = text.split("\n")
  const replies = []

  for (let i = lines.length - 1; i >= 0; i--) {
    signal?.throwIfAborted()
    const step = parseTranscriptLine(lines[i])
    if (!step) continue
    if (step.source !== "MODEL" || step.type !== "PLANNER_RESPONSE" || step.status !== "DONE") continue

    let content = step.content || ""
    if (step.truncated_fields && step.truncated_fields.includes("content")) {
      const full = await readFullStep(brainDir, step.step_index)
      if (full && full.content) content = full.content
    }

    const cleaned = cleanModelContent(content)
    const hasToolCalls = Array.isArray(step.tool_calls) && step.tool_calls.length > 0
    if (!cleaned && hasToolCalls) continue

    replies.push({
      id: String(step.step_index),
      text: cleaned,
      progress: hasToolCalls,
      created: Date.parse(step.created_at) || Date.now(),
      toolCalls: step.tool_calls?.map(t => t.name) || [],
    })
  }

  return replies
}

export function latestCompletedReply(replies) {
  return replies.find(r => !r.progress && r.text.trim()) || null
}
