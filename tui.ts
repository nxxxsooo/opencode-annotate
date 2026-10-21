import { Plugin } from "@opencode/plugin/tui"
import { createReviewCommand } from "./review.mjs"

export default Plugin.define({
  id: "opencode-annotate",
  setup(context) {
    const review = createReviewCommand(context)
    // 2.0.22's keymap.layer needs the mounted provider; newer hosts also allow setup().
    const unmount = context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "opencode-annotate.annotate",
            title: "Annotate reply, document, or webpage",
            description: "Text defaults to TUI; explicit HTML, URL or web pairs browser review",
            group: "Annotate",
            palette: true,
            slash: { name: "annotate", arguments: true },
            run: review.run,
          }, {
            id: "opencode-annotate.annotate-last",
            title: "Annotate last reply (TUI)",
            description: "Annotate the latest completed reply; press q, then confirm to send",
            group: "Annotate",
            palette: true,
            // Keep slash submission with a trailing space local to the command.
            // Any supplied argument is deliberately ignored: this always means latest.
            slash: { name: "annotate-last", arguments: true },
            run: () => review.run(),
          }],
        }))
        return null
      },
    })
    return () => {
      review.dispose()
      unmount()
    }
  },
})
