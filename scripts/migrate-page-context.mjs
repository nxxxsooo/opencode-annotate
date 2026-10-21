import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { safeUrl, validateReview } from "../browser/protocol.mjs"

export function migratePageContext(storage) {
  const result = {}
  for (const [key, page] of Object.entries(storage)) {
    if (!key.startsWith("page:")) continue
    if (!page?.page?.url || !Array.isArray(page.notes)) throw new Error(`Unrecognized old draft: ${key}`)
    const source = { url: safeUrl(page.page.url), title: page.page.title || "Page" }
    const hash = createHash("sha256").update(source.url).digest("hex")
    for (const old of page.notes) {
      const note = { id: old.id, revision: 1, kind: old.kind, comment: old.body,
        createdAt: old.createdAt, updatedAt: old.updatedAt || old.createdAt,
        anchor: { ...old.target, element: old.target.label || old.target.role || old.target.type,
          styles: old.target.styles || "", accessibility: old.target.accessibility || "", fullPath: old.target.selector }, page: source }
      validateReview({ version: 1, page: source, annotations: [note] })
      const destination = `note:${hash}:${note.id}`
      if (result[destination]) throw new Error("Duplicate note during migration")
      result[destination] = note
    }
  }
  return result
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw new Error("Usage: migrate-page-context.mjs input.json output.json")
  const records = migratePageContext(JSON.parse(await readFile(process.argv[2], "utf8")))
  await writeFile(process.argv[3], JSON.stringify(records, null, 2), { mode: 0o600, flag: "wx" })
  console.log(`Prepared ${Object.keys(records).length} notes for import; source backup unchanged.`)
}
