import { execFile } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { promisify } from "node:util"

const execute = promisify(execFile)
export const slashSaver = "/Applications/Slash Saver.app/Contents/MacOS/SlashSaver"

// A Chinese input method swallows single-letter shortcuts, so key-driven screens switch to
// the ASCII source Slash Saver is configured with and restore the previous source after.
// `option` is a command path, false to disable, or undefined to use Slash Saver if installed.
export function createInputSource(option) {
  const command = resolve(option)
  const run = async args => (await execute(command, ["input-source", ...args], { timeout: 3000 })).stdout.trim()
  // Switching is a convenience: a missing or failing helper never blocks a review.
  const quietly = async args => {
    try {
      return await run(args)
    } catch {
      return undefined
    }
  }
  return {
    command,
    /** Selects the ASCII source; returns the previous source ID. */
    ascii: () => command ? quietly(["ascii"]) : Promise.resolve(undefined),
    select: id => command && id ? quietly(["select", id]) : Promise.resolve(undefined),
  }
}

function resolve(option) {
  if (option === false || process.platform !== "darwin") return undefined
  if (typeof option === "string") return option
  try {
    accessSync(slashSaver, constants.X_OK)
    return slashSaver
  } catch {
    return undefined
  }
}

// Holds ASCII while any key-driven prompt is open and restores the source once all close.
export function createAsciiHold(inputSource) {
  const open = new Set()
  let previous
  let pending = Promise.resolve()
  const queue = step => (pending = pending.then(step))
  return {
    enter: id => queue(async () => {
      if (open.has(id)) return
      open.add(id)
      if (open.size === 1) previous = await inputSource.ascii()
    }),
    leave: id => queue(async () => {
      if (!open.delete(id) || open.size > 0) return
      const restore = previous
      previous = undefined
      await inputSource.select(restore)
    }),
  }
}
