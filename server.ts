import { Plugin } from "@opencode/plugin"
import { registerSessionTools } from "./session-tools.mjs"

export default Plugin.define({
  id: "opencode-annotate",
  async setup(context) {
    await registerSessionTools(context)
  },
})
