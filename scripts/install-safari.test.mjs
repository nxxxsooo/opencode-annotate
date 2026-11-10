import { test } from "node:test"
import assert from "node:assert/strict"
import { installSafari } from "./install-safari.mjs"

test("Safari installer rejects destructive targets before filesystem or registration work", async () => {
  for (const target of ["", "/", "/Applications", "relative.app", "/Applications/.app", "/Applications/annotate.app/..", null]) {
    await assert.rejects(installSafari({ source: "/missing/source.app", target }), /absolute \.app bundle path/)
  }
  for (const source of ["", "  ", null]) await assert.rejects(installSafari({ source }), /nonempty path/)
  await assert.rejects(installSafari({ source: "/Applications/annotate.app", target: "/Applications/annotate.app" }), /outside the install target/)
  await assert.rejects(installSafari({ source: "/Applications/annotate.app/nested.app", target: "/Applications/annotate.app" }), /outside the install target/)
  await assert.rejects(installSafari({ source: "/missing/source.app", target: "/Applications/annotate.app" }), /Build the app first/)
})
