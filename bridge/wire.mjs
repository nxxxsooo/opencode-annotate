import net from "node:net"
import { MAX_BYTES } from "../browser/protocol.mjs"

export function encode(value) {
  const body = Buffer.from(JSON.stringify(value))
  if (body.length > MAX_BYTES) throw new Error("Message exceeds 512 KiB")
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length)
  return Buffer.concat([header, body])
}
export function decodeStream(stream, onMessage, onError) {
  let buffer = Buffer.alloc(0), stopped = false
  const data = chunk => {
    if (stopped) return
    try {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4) {
        const size = buffer.readUInt32LE(0)
        if (!size || size > MAX_BYTES) throw new Error("Invalid frame size")
        if (buffer.length < size + 4) break
        const value = JSON.parse(buffer.subarray(4, size + 4).toString("utf8"))
        buffer = buffer.subarray(size + 4); onMessage(value)
      }
    } catch (error) { stopped = true; onError(error) }
  }
  stream.on("data", data)
  return () => { stopped = true; stream.off("data", data) }
}
export function request(socketPath, value) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    const done = (error, result) => { stop(); socket.destroy(); error ? reject(error) : resolve(result) }
    const stop = decodeStream(socket, result => done(null, result), error => done(error))
    socket.setTimeout(15000, () => done(new Error("Annotation receiver timed out")))
    socket.once("error", error => done(error))
    socket.once("end", () => done(new Error("Annotation receiver disconnected")))
    socket.once("connect", () => { try { socket.write(encode(value)) } catch (error) { done(error) } })
  })
}
