import { mkdir, readdir, readFile, rm, writeFile, chmod } from "node:fs/promises"
import path from "node:path"
import os from "node:os"

export const defaultInboxRoot = () => path.join(os.homedir(), ".local/share/opencode-annotate/inbox")

export async function enqueueAnnotations(conversationId, payload, inboxRoot = defaultInboxRoot()) {
  if (!conversationId) throw new Error("Conversation ID is required to enqueue annotations")
  const sessionInbox = path.join(inboxRoot, conversationId)
  await mkdir(sessionInbox, { recursive: true, mode: 0o700 })
  await chmod(sessionInbox, 0o700)

  const batchID = payload.batchID || `batch-${Date.now()}`
  const file = path.join(sessionInbox, `${batchID}.json`)
  const record = {
    batchID,
    createdAt: new Date().toISOString(),
    promptID: payload.promptID,
    markdown: payload.markdown,
    review: payload.review,
  }

  await writeFile(file, JSON.stringify(record, null, 2), { mode: 0o600 })
  return { file, batchID }
}

export async function listPendingBatches(conversationId, inboxRoot = defaultInboxRoot()) {
  const sessionInbox = path.join(inboxRoot, conversationId)
  let files
  try {
    files = await readdir(sessionInbox)
  } catch (error) {
    if (error.code === "ENOENT") return []
    throw error
  }

  const batches = []
  for (const name of files.filter(f => f.endsWith(".json")).sort()) {
    const filePath = path.join(sessionInbox, name)
    try {
      const data = JSON.parse(await readFile(filePath, "utf8"))
      batches.push({ ...data, filePath })
    } catch {
      // Ignore corrupt or in-flight writes
    }
  }
  return batches
}

export async function dequeueAnnotations(conversationId, inboxRoot = defaultInboxRoot()) {
  const batches = await listPendingBatches(conversationId, inboxRoot)
  if (!batches.length) return null

  const markdowns = []
  const batchIDs = []

  for (const batch of batches) {
    if (batch.markdown) markdowns.push(batch.markdown)
    batchIDs.push(batch.batchID)
    try {
      await rm(batch.filePath, { force: true })
    } catch {
      // Ignore cleanup error
    }
  }

  return {
    batchIDs,
    combinedMarkdown: markdowns.join("\n\n---\n\n"),
    count: batches.length,
  }
}
