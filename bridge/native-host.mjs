import { readFile } from "node:fs/promises"
import { decodeStream, encode, request } from "./wire.mjs"
import { listTargets } from "./receiver.mjs"

const configPath = process.argv[2]
const origin = process.argv[3]
const config = JSON.parse(await readFile(configPath, "utf8"))
if (origin !== `chrome-extension://${config.extensionID}/`) throw new Error("Unapproved extension origin")
let handled = false
const timeout = setTimeout(() => process.exit(1), 20000)
decodeStream(process.stdin, async message => {
  if (handled) return
  handled = true; process.stdin.pause()
  let response
  try {
    const targets = await listTargets(config.targetsDirectory)
    if (message.action === "targets") {
      const live = await Promise.all(targets.map(async target => {
        try { return (await request(target.socket, { action: "info", targetID: target.id })).target } catch { return null }
      }))
      response = { ok: true, targets: live.filter(Boolean) }
    } else {
      const target = targets.find(target => target.id === message.targetID)
      if (!target) throw new Error("Paired session is offline; run /annotate web and pair again")
      response = await request(target.socket, message)
    }
  } catch (error) { response = { ok: false, error: error.message } }
  clearTimeout(timeout); process.stdout.end(encode(response))
}, error => { clearTimeout(timeout); process.stdout.end(encode({ ok: false, error: error.message })) })
