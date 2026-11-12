import { Plugin } from "@opencode/plugin"
import { registerConfiguration } from "./configuration.mjs"

export default Plugin.define({
  id: "opencode-annotate",
  async setup(context) {
    await registerConfiguration(context)
  },
})
