import { Plugin } from "@opencode/plugin/tui"
import { createReviewCommand } from "./review.mjs"

export default Plugin.define({
  id: "opencode-plannotator-tui",
  setup(context) {
    const review = createReviewCommand(context)
    // 2.0.22's keymap.layer needs the mounted provider; newer hosts also allow setup().
    const unmount = context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "opencode-plannotator-tui.annotate",
            title: "Annotate reply or document (TUI)",
            description: "Annotate a reply (1 = latest, 2 = previous) or a file; press q, then confirm to send",
            group: "Plannotator",
            palette: true,
            slash: { name: "annotate", arguments: true },
            run: review.run,
          }, {
            id: "opencode-plannotator-tui.annotate-last",
            title: "Annotate last reply (TUI)",
            description: "Annotate the latest completed reply; press q, then confirm to send",
            group: "Plannotator",
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
