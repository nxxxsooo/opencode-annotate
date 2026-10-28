#!/usr/bin/env node
import { spawn } from "node:child_process"
import { bundledBinary } from "./binary.mjs"

const child = spawn(bundledBinary(), process.argv.slice(2), { stdio: "inherit" })
child.on("error", error => {
  console.error(error.code === "ENOENT"
    ? "Annotate TUI is missing. In a checkout, run npm run build:tui; otherwise reinstall the package."
    : error.message)
  process.exitCode = 1
})
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
