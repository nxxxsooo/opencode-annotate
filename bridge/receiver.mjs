import net from "node:net"
import { randomUUID, createHash } from "node:crypto"
import { mkdir, chmod, writeFile, readdir, readFile, rm, lstat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { encode, decodeStream } from "./wire.mjs"
import { markdown, validateReview } from "../browser/protocol.mjs"
import { feedbackInput } from "../delivery.mjs"

export const registryRoot = () => path.join(os.homedir(), ".local/share/opencode-annotate/targets")
export async function listTargets(root = registryRoot()) {
  let files
  try { files = await readdir(root) } catch (error) { if (error.code === "ENOENT") return []; throw error }
  const results = []
  for (const file of files.filter(name => /^[a-f0-9-]+\.json$/.test(name))) {
    const location = path.join(root, file)
    const info = await lstat(location)
    if (info.isSymbolicLink() || (info.mode & 0o077) || info.uid !== process.getuid() || info.size > 16384) continue
    try {
      const value = JSON.parse(await readFile(location, "utf8"))
      if (typeof value.id !== "string" || file !== `${value.id}.json` || value.socket !== path.join(root, `${value.id}.sock`)) continue
      try { process.kill(value.pid, 0) } catch { continue }
      results.push(value)
    } catch { /* stale/incomplete registration is not a target */ }
  }
  return results
}
export async function createReceiver({ sessionID, title, directory, provider = "opencode", deliver, client, getInfo, createSession, root = registryRoot(), resume = true, onError = () => {} }) {
  await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700)
  const id = randomUUID(), registered = Date.now(), socketPath = path.join(root, `${id}.sock`)
  // macOS sockaddr_un is limited to 104 bytes, including the NUL terminator.
  if (Buffer.byteLength(socketPath) > 103) throw new Error("Annotation socket path is too long")
  const kind = sessionID ? "session" : "workspace"
  const target = { id, title, directory, sessionID, provider, kind, socket: socketPath, pid: process.pid }
  const received = new Map(), creations = new Map(), sockets = new Set()
  let closed = false, connected = !!sessionID
  async function info() {
    if (closed) throw new Error("Annotation connection is closed")
    const extra = getInfo ? await getInfo() : {}
    if (extra === null) return null
    const session = client && sessionID ? await client.session.get({ sessionID }) : undefined
    const time = session?.time ? { created: session.time.created, updated: session.time.updated } : {}
    return { id, title: session?.title || title, directory, provider, sessionID, kind, registered,
      ...time, ...extra, connected, canCreate: !!createSession }
  }
  const server = net.createServer(socket => {
    let handled = false
    sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.on("error", () => {})
    socket.setTimeout(20000, () => socket.destroy())
    decodeStream(socket, async message => {
      if (handled) return
      handled = true
      try {
        if (closed || message.targetID !== id) throw new Error("Pairing is no longer active")
        if (message.action === "info") {
          // Registration happens before OpenCode generates a title; report the live one.
          socket.end(encode({ ok: true, target: await info() })); return
        }
        if (["connect", "disconnect"].includes(message.action)) {
          if (!sessionID) throw new Error("Create a session in this workspace first")
          connected = message.action === "connect"
          socket.end(encode({ ok: true, target: await info() })); return
        }
        if (message.action === "create-session") {
          if (!createSession || !/^[a-f0-9-]{36}$/.test(message.requestID)) throw new Error("Invalid session creation request")
          if (!creations.has(message.requestID)) {
            const promise = Promise.resolve().then(createSession)
            creations.set(message.requestID, promise)
            promise.catch(() => creations.delete(message.requestID))
          }
          socket.end(encode({ ok: true, target: await creations.get(message.requestID) })); return
        }
        if (!connected) throw new Error("Session disconnected; select it in Annotate to reconnect")
        if (message.action !== "send" || !/^[a-f0-9-]{36}$/.test(message.batchID)) throw new Error("Invalid delivery request")
        const review = structuredClone(validateReview(message.review)), text = markdown(review)
        const digest = createHash("sha256").update(JSON.stringify(review)).digest("hex")
        const existing = received.get(message.batchID)
        if (existing && existing.digest !== digest) throw new Error("Batch ID was reused with different content")
        if (!existing) {
          // Capture immutable input before awaiting; simultaneous retries share one admission promise.
          const promptID = `msg_${createHash("sha256").update(`${id}:${message.batchID}`).digest("hex").slice(0, 32)}`
          const promise = (async () => {
            if (deliver) {
              const res = await deliver({ review, promptID, markdown: text, batchID: message.batchID })
              return { ok: true, messageID: res?.id || promptID, state: "admitted" }
            }
            await client.session.get({ sessionID })
            const response = await client.session.prompt(feedbackInput({ sessionID, id: promptID, text, resume }))
            return { ok: true, messageID: response?.id || promptID, state: "admitted" }
          })()
          received.set(message.batchID, { digest, promise })
          promise.catch(() => received.delete(message.batchID))
        }
        socket.end(encode(await received.get(message.batchID).promise))
      } catch (error) { if (!socket.destroyed) socket.end(encode({ ok: false, error: error.message })) }
    }, () => socket.destroy())
  })
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve) })
  server.on("error", onError)
  await chmod(socketPath, 0o600)
  const registration = path.join(root, `${id}.json`)
  try { await writeFile(registration, JSON.stringify(target), { mode: 0o600, flag: "wx" }) }
  catch (error) { await new Promise(resolve => server.close(resolve)); await rm(socketPath, { force: true }); throw error }
  return { target, info, async close() {
    if (closed) return
    closed = true; for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
    await rm(registration, { force: true }); await rm(socketPath, { force: true })
  } }
}
