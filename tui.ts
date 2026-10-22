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
            title: "Annotate reply or document",
            description: "The latest completed reply, or a Markdown/text file path",
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
          }, {
            id: "opencode-annotate.annotate-pick",
            title: "Annotate earlier text (TUI)",
            description: "Choose a recent reply or progress update to annotate",
            group: "Annotate",
            palette: true,
            slash: { name: "annotate-pick", arguments: true },
            run: () => review.pick(),
          }, {
            id: "opencode-annotate.annotate-selection",
            title: "Annotate selected text (TUI)",
            description: "Open the message containing your last selection in this session",
            group: "Annotate",
            palette: true,
            slash: { name: "annotate-selection", arguments: true },
            run: () => review.selection(),
          }, {
            id: "opencode-annotate.annotate-web",
            title: "Annotate webpage (browser)",
            description: "Pair Chrome with this session, open a URL or HTML file, or off",
            group: "Annotate",
            palette: true,
            slash: { name: "annotate-web", arguments: true },
            run: review.web,
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
