import { readFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createReceiver, registryRoot } from "../bridge/receiver.mjs"
import { enqueueAnnotations, defaultInboxRoot } from "./inbox.mjs"

export async function getAgySessionTitle(conversationId, fallback = "Antigravity Session") {
  if (!conversationId) return fallback
  try {
    const pbtxt = path.join(os.homedir(), ".gemini/antigravity-cli/annotations", `${conversationId}.pbtxt`)
    const raw = await readFile(pbtxt, "utf8")
    const match = raw.match(/title:\s*"([^"]+)"/)
    if (match && match[1]) return match[1]
  } catch {
    // pbtxt might not exist for newly started sessions
  }
  return fallback
}

export async function createAgyReceiver({
  conversationId,
  title,
  directory = process.cwd(),
  root = registryRoot(),
  inboxRoot = defaultInboxRoot(),
  onError = () => {},
}) {
  if (!conversationId) throw new Error("Conversation ID is required for AGY receiver")

  const sessionTitle = title || (await getAgySessionTitle(conversationId, path.basename(directory)))

  return createReceiver({
    sessionID: conversationId,
    title: sessionTitle,
    directory,
    provider: "agy",
    root,
    onError,
    deliver: async ({ review, batchID, markdown, promptID }) => {
      const result = await enqueueAnnotations(conversationId, { review, batchID, markdown, promptID }, inboxRoot)
      return { id: result.batchID }
    },
  })
}
