import { Plugin } from "@opencode/plugin/tui"
import { createReviewCommand } from "./review.mjs"
import { createAsciiHold, createInputSource } from "./input-source.mjs"
import { createReferenceCommand } from "./reference-command.mjs"
import { createAutoReview } from "./auto-review.mjs"
import { watchConfiguration } from "./configuration.mjs"

export default Plugin.define({
  id: "opencode-annotate",
  async setup(context) {
    const host = context
    let options = host.options
    context = { ...host, get options() { return options } }
    let restartAutoReview: (() => void) | undefined
    let stopAutoReview = () => {}
    const configuration = watchConfiguration(context, updated => {
      const changed = options.autoAnnotate !== updated.autoAnnotate
        || options.autoAnnotateThreshold !== updated.autoAnnotateThreshold
      options = updated
      if (changed) restartAutoReview?.()
    })
    await configuration.ready
    const inputSource = createInputSource(context.options.inputSource)
    const review = createReviewCommand(context, { inputSource })
    restartAutoReview = () => {
      stopAutoReview()
      stopAutoReview = createAutoReview(context, review)
    }
    restartAutoReview()
    const reference = createReferenceCommand(context)
    // Permission prompts answer with single letters, which an input method swallows.
    const hold = createAsciiHold(inputSource)
    const stopAsked = context.data.on("permission.asked", event => hold.enter(event.data.id))
    const stopReplied = context.data.on("permission.replied", event => hold.leave(event.data.requestID))
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
            description: "Annotate the latest completed reply; q sends and returns",
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
            description: "Pair Chrome (creates a session if needed), open a URL or HTML file, or off",
            group: "Annotate",
            palette: true,
            slash: { name: "annotate-web", arguments: true },
            run: review.web,
          }, {
            id: "opencode-annotate.ref",
            title: "Reference another conversation",
            description: "Attach a past conversation by title or session ID; --all searches across projects",
            group: "Annotate",
            palette: true,
            slash: { name: "ref", arguments: true },
            run: reference.run,
          }],
        }))
        return null
      },
    })
    return () => {
      stopAsked()
      stopReplied()
      configuration.dispose()
      stopAutoReview()
      review.dispose()
      reference.dispose()
      unmount()
    }
  },
})
