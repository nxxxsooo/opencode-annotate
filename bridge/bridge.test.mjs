import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { PassThrough } from "node:stream"
import { browserTarget, wantsBrowser } from "../targets.mjs"
import { createReceiver, listTargets } from "./receiver.mjs"
import { encode, decodeStream, request } from "./wire.mjs"
import { markdown, orderedNotes, safeUrl, validateReview } from "../browser/protocol.mjs"
import { installBridge, resolveNode } from "../scripts/install-bridge.mjs"
import { migratePageContext } from "../scripts/migrate-page-context.mjs"

const review = () => ({ version: 2, annotations: [
  { page: { url: "https://example.test/page", title: "Fixture" }, id: "note-1", revision: 1, kind: "ask", comment: "Explain this paragraph", createdAt: new Date().toISOString(),
    anchor: { type: "text", quote: "same", prefix: "second ", suffix: " occurrence", selector: "#paragraph", styles: "font: 16px", accessibility: "role=main" } },
] })
test("v2 reviews carry validated pages per annotation and group the global round", () => {
  const batch = review(), first = batch.annotations[0]
  batch.annotations.push({ ...first, id: "note-2", page: { url: "https://example.test/other", title: "Other page" } },
    { ...first, id: "note-3" })
  const text = markdown(batch)
  assert.equal((text.match(/untrusted source material/g) || []).length, 1)
  assert.equal((text.match(/^## Fixture$/gm) || []).length, 1)
  assert.match(text, /## Other page\nURL: https:\/\/example.test\/other/)
  for (let number = 1; number <= 3; number++) assert.ok(text.includes(`### Annotation ${number} (ask)`))
  assert.throws(() => validateReview({ ...batch, version: 1 }), /envelope/)
  assert.throws(() => validateReview({ ...batch, page: first.page }), /envelope/)
  for (const page of [undefined, { url: "javascript:alert(1)", title: "Unsafe" }, { url: "https://example.test/?token=secret", title: "Unsafe" }, { ...first.page, title: "Title\nNew heading" }]) {
    assert.throws(() => validateReview({ version: 2, annotations: [{ ...first, page }] }))
  }
})
test("interleaved page notes share contiguous display, marker and delivery ordering", () => {
  const first = review().annotations[0], other = { url: "https://example.test/other", title: "Other page" }
  const notes = [
    { ...first, id: "a1", comment: "A first", createdAt: "2026-11-12T00:00:00Z" },
    { ...first, id: "b1", page: other, comment: "B first", createdAt: "2026-11-12T00:01:00Z" },
    { ...first, id: "a3", comment: "A third", createdAt: "2026-11-12T00:02:00Z" },
    { ...first, id: "a2", comment: "A second", createdAt: "2026-11-12T00:02:00Z" },
  ]
  const ordered = orderedNotes(notes)
  assert.deepEqual(ordered.map(note => note.id), ["a1", "a2", "a3", "b1"])
  assert.deepEqual(notes.map(note => note.id), ["a1", "b1", "a3", "a2"], "ordering must not mutate the source")
  assert.deepEqual(orderedNotes([...notes].reverse()), ordered, "input/storage order must not affect the round")
  const text = markdown({ version: 2, annotations: notes })
  assert.deepEqual([...text.matchAll(/^### Annotation (\d+)/gm)].map(match => Number(match[1])), [1, 2, 3, 4])
  assert.ok(text.indexOf("A first") < text.indexOf("A second"))
  assert.ok(text.indexOf("A second") < text.indexOf("A third"))
  assert.ok(text.indexOf("A third") < text.indexOf("## Other page"))
  assert.ok(text.indexOf("## Other page") < text.indexOf("### Annotation 4"))
})
test("Chrome extension version matches the package release", async () => {
  const read = file => readFile(new URL(file, import.meta.url), "utf8").then(JSON.parse)
  const [pkg, manifest] = await Promise.all([read("../package.json"), read("../browser/manifest.json")])
  assert.equal(manifest.version, pkg.version)
})
async function fixture(t) {
  const base = path.join(os.homedir(), ".cache")
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(path.join(base, "oa-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
test("routing is explicit and preserves text defaults", async t => {
  const root = await fixture(t)
  await writeFile(path.join(root, "中文 space.HTML"), "<h1>Fixture</h1>")
  for (const input of ["", "1", "2", "notes.md", "reply.txt", "web", "web off"]) assert.equal(wantsBrowser(input), false)
  assert.equal(wantsBrowser('"中文 space.HTML"'), true)
  assert.match((await browserTarget('"中文 space.HTML"', root)).url, /^file:/)
  assert.equal((await browserTarget("https://example.test", root)).type, "browser")
  assert.equal(await browserTarget("web", root), null)
  await assert.rejects(browserTarget("javascript:alert(1)", root))
  await assert.rejects(browserTarget("missing.html", root))
})
test("export includes styles, a11y and full redacted URL", () => {
  const text = markdown(review())
  for (const expected of ["https://example.test/page", "font: 16px", "role=main", "Explain this paragraph", "second 【same】 occurrence"]) assert.ok(text.includes(expected), expected)
  assert.ok(!safeUrl("https://user:pass@example.test/?token=xyz").includes("xyz"))
})
test("old Page Context drafts retain identifiers, selected text, feedback and page", () => {
  const old = { "page:https://example.test/": { page: { url: "https://example.test/", title: "Old" }, notes: [
    { id: "old-one", kind: "ask", body: "Keep this question", createdAt: "2026-10-19T00:00:00Z", target: { type: "text", quote: "same", selector: "#x" } },
  ] } }
  const migrated = Object.values(migratePageContext(old))
  assert.equal(migrated.length, 1); assert.equal(migrated[0].id, "old-one"); assert.equal(migrated[0].comment, "Keep this question")
  assert.equal(migrated[0].anchor.quote, "same"); assert.equal(migrated[0].page.title, "Old")
  assert.equal(old["page:https://example.test/"].notes[0].body, "Keep this question")
})
test("framing handles split UTF-8 byte chunks and rejects oversize frames", () => {
  const stream = new PassThrough(), result = [], errors = []
  decodeStream(stream, value => result.push(value), error => errors.push(error))
  const bytes = encode({ text: "中文 😀" })
  for (const byte of bytes) stream.write(Buffer.from([byte]))
  assert.deepEqual(result, [{ text: "中文 😀" }])
  stream.write(Buffer.from([255, 255, 255, 255])); assert.equal(errors.length, 1)
  stream.destroy()
})
test("duplicate retries admit once to the captured session", async t => {
  const root = await fixture(t), sent = []
  const receiver = await createReceiver({ root, sessionID: "ses_original", title: "Original", directory: "/project", resume: false,
    client: { session: { get: async () => ({}), prompt: async input => { sent.push(input); return { id: input.id } } } } })
  t.after(() => receiver.close())
  const batch = { action: "send", targetID: receiver.target.id, batchID: randomUUID(), review: review() }
  const [a, b] = await Promise.all([request(receiver.target.socket, batch), request(receiver.target.socket, batch)])
  assert.equal(a.state, "admitted"); assert.deepEqual(a, b); assert.equal(sent.length, 1)
  assert.equal(sent[0].sessionID, "ses_original"); assert.equal(sent[0].resume, false); assert.equal(sent[0].delivery, "steer")
  const conflict = structuredClone(batch); conflict.review.annotations[0].comment = "different"
  assert.equal((await request(receiver.target.socket, conflict)).ok, false)
  assert.equal((await listTargets(root)).length, 1)
})
test("failed admission can retry with the same id and never reports success early", async t => {
  const root = await fixture(t), ids = []
  const receiver = await createReceiver({ root, sessionID: "ses_original", title: "Original", directory: "/project",
    client: { session: { get: async () => ({}), prompt: async input => { ids.push(input.id); if (ids.length === 1) throw new Error("offline"); return { id: input.id } } } } })
  t.after(() => receiver.close())
  const batch = { action: "send", targetID: receiver.target.id, batchID: randomUUID(), review: review() }
  assert.equal((await request(receiver.target.socket, batch)).ok, false)
  assert.equal((await request(receiver.target.socket, batch)).state, "admitted")
  assert.equal(ids[0], ids[1])
  assert.equal((await request(receiver.target.socket, { ...batch, targetID: "another" })).ok, false)
})
test("receiver cleanup revokes registration and socket", async t => {
  const root = await fixture(t)
  const receiver = await createReceiver({ root, sessionID: "ses_x", title: "X", directory: "/project", client: { session: { get: async () => ({}) } } })
  await receiver.close()
  assert.deepEqual(await listTargets(root), [])
  await assert.rejects(request(receiver.target.socket, {}))
})
test("receiver supports custom provider and custom deliver callback", async t => {
  const root = await fixture(t), delivered = []
  const receiver = await createReceiver({
    root,
    provider: "agy",
    sessionID: "agy-conv-123",
    title: "AGY Conversation",
    directory: "/workspace/agy",
    deliver: async payload => {
      delivered.push(payload)
      return { id: "custom-msg-id" }
    },
  })
  t.after(() => receiver.close())
  const targets = await listTargets(root)
  assert.equal(targets.length, 1)
  assert.equal(targets[0].provider, "agy")
  assert.equal(targets[0].sessionID, "agy-conv-123")

  const info = await request(receiver.target.socket, { action: "info", targetID: receiver.target.id })
  assert.equal(info.ok, true)
  assert.equal(info.target.provider, "agy")

  const batch = { action: "send", targetID: receiver.target.id, batchID: randomUUID(), review: review() }
  const result = await request(receiver.target.socket, batch)
  assert.equal(result.ok, true)
  assert.equal(result.state, "admitted")
  assert.equal(result.messageID, "custom-msg-id")
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].batchID, batch.batchID)
  assert.ok(delivered[0].markdown.includes("Explain this paragraph"))
})
test("automatic host setup resolves Node instead of the OpenCode executable", async t => {
  const root = await fixture(t), bin = path.join(root, "bin")
  await mkdir(bin)
  const node = path.join(bin, "node")
  await writeFile(node, "", { mode: 0o700 })
  assert.equal(await resolveNode({ execPath: "/Applications/OpenCode.app/Contents/MacOS/opencode", pathEnv: bin, platform: "darwin" }), node)
  assert.equal(await resolveNode({ execPath: node, pathEnv: "", platform: "darwin" }), node)
  await assert.rejects(resolveNode({ execPath: "/usr/bin/opencode", pathEnv: "", platform: "linux" }), /Node\.js 22\+/)
})
test("native host uses exact origin allowlist and standard framed replies", async t => {
  const root = await fixture(t)
  const receiver = await createReceiver({ root, sessionID: "ses_native", title: "ses_native", directory: "/project",
    client: { session: { get: async () => ({ title: "Generated title", time: { created: 1, updated: 2 } }) } } })
  t.after(() => receiver.close())
  const installation = await installBridge({ profileDirectory: path.join(root, "chrome"), installRoot: path.join(root, "host"), targetsDirectory: root })
  const manifest = JSON.parse(await readFile(installation.hostManifest, "utf8"))
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${installation.extensionID}/`])
  await installBridge({ profileDirectory: path.join(root, "chrome"), installRoot: path.join(root, "host"), targetsDirectory: root })
  assert.equal((await readdir(path.dirname(installation.hostManifest))).some(name => name.includes(".backup-")), false, "automatic registration must not create backups when nothing changed")
  const exchange = message => {
    const child = spawn(installation.launcher, [manifest.allowed_origins[0]], { stdio: ["pipe", "pipe", "pipe"] })
    return new Promise((resolve, reject) => {
      decodeStream(child.stdout, resolve, reject)
      child.once("error", reject)
      child.stdin.end(encode(message))
    })
  }
  const result = await exchange({ action: "targets" })
  assert.equal(result.ok, true); assert.equal(result.targets.length, 1); assert.equal(result.targets[0].sessionID, "ses_native")
  assert.equal(result.targets[0].title, "Generated title", "discovery must report the live title, not the one captured at registration")
  assert.deepEqual([result.targets[0].created, result.targets[0].updated], [1, 2])
  const paired = await exchange({ action: "info", targetID: receiver.target.id })
  assert.equal(paired.ok, true); assert.equal(paired.target.sessionID, "ses_native")
  const rejected = spawn(installation.launcher, ["chrome-extension://not-allowed/"], { stdio: ["ignore", "ignore", "pipe"] })
  rejected.stderr.resume()
  assert.notEqual(await new Promise(resolve => rejected.once("exit", resolve)), 0)
})
