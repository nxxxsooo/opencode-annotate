import { spawnSync } from "node:child_process"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import path from "node:path"
import os from "node:os"
import { getAgySessionTitle } from "./receiver.mjs"

export const agyConfigDir = () => path.join(os.homedir(), ".gemini/antigravity-cli")

export function getActiveAgySessions(baseDir = agyConfigDir()) {
  const presenceDir = path.join(baseDir, "presence")
  const dbPath = path.join(baseDir, "conversation_summaries.db")

  const proc = spawnSync("lsof", ["+D", presenceDir], { encoding: "utf8" })
  const stdout = proc.stdout || ""
  const lockMap = new Map()

  for (const line of stdout.split("\n")) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 9 && parts[0] === "agy") {
      const pid = parseInt(parts[1], 10)
      const nodeName = parts[parts.length - 1]
      if (nodeName.endsWith(".lock")) {
        const conversationId = path.basename(nodeName, ".lock")
        lockMap.set(conversationId, pid)
      }
    }
  }

  if (lockMap.size === 0) return []

  let db
  try {
    db = new DatabaseSync(dbPath, { open: true, readOnly: true })
  } catch {
    // Database might be temporarily locked or not exist
  }

  const query = db?.prepare("SELECT title, workspace_uris FROM conversation_summaries WHERE conversation_id = ?")
  const results = []

  for (const [conversationId, pid] of lockMap.entries()) {
    let title = ""
    let directory = ""

    if (query) {
      try {
        const row = query.get(conversationId)
        if (row) {
          title = row.title || ""
          if (row.workspace_uris) {
            try {
              const uris = JSON.parse(row.workspace_uris)
              if (Array.isArray(uris) && uris[0]) {
                directory = fileURLToPath(uris[0])
              }
            } catch {}
          }
        }
      } catch {}
    }

    results.push({
      conversationId,
      pid,
      title: title || `Session ${conversationId.slice(0, 8)}`,
      directory: directory || process.cwd(),
    })
  }

  return results
}

export function findSessionForDirectory(dir = process.cwd(), baseDir = agyConfigDir()) {
  const sessions = getActiveAgySessions(baseDir)
  const normalized = path.resolve(dir)

  // Exact match first
  const exact = sessions.find(s => path.resolve(s.directory) === normalized)
  if (exact) return exact

  // Parent directory or child directory match
  const matched = sessions.find(s => {
    const sDir = path.resolve(s.directory)
    return normalized.startsWith(sDir) || sDir.startsWith(normalized)
  })
  if (matched) return matched

  // Fall back to first session if only one exists
  if (sessions.length === 1) return sessions[0]

  return null
}
