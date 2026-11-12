import { Plugin } from "@opencode/plugin/tui"
import { createReviewCommand } from "./review.mjs"
import { createAsciiHold, createInputSource } from "./input-source.mjs"
import { createReferenceCommand } from "./reference-command.mjs"
import { promptReferenceComment } from "./reference-comment.tsx"
import { createAutoReview } from "./auto-review.mjs"
import { watchConfiguration } from "./configuration.mjs"
import { installBridge } from "./scripts/install-bridge.mjs"

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
        || options.browser !== updated.browser
      options = updated
      if (changed) restartAutoReview?.()
    })
    await configuration.ready
    if (process.platform === "darwin") void installBridge().catch(error => {
      context.ui.toast.show({ title: "Annotate", message: `Browser auto-setup failed: ${error.message}. Run npm run install:bridge to repair it.`, variant: "error", duration: 15000 })
    })
    const inputSource = createInputSource(context.options.inputSource)
    const review = createReviewCommand(context, { inputSource, web: { autoRegister: true, browser: options.browser } })
    restartAutoReview = () => {
      stopAutoReview()
      stopAutoReview = createAutoReview(context, review)
    }
    restartAutoReview()
    const reference = createReferenceCommand(context, {
      review, promptComment: (options, signal) => promptReferenceComment(context, options, signal),
    })
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
            title: "Annotate reply, document or webpage",
            description: "The latest completed reply, a file path, or a webpage URL",
            group: "Annotate",
            palette: true,
            slash: { name: "annotate", arguments: true },
            run: review.run,
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
            id: "opencode-annotate.ref",
            title: "Reference another conversation",
            description: "Attach a past conversation with a comment or TUI annotations; --all searches across projects",
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
