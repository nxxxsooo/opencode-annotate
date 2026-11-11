import type { TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { onMount } from "solid-js"
import type { Context, DialogPromptOptions } from "@opencode/plugin/tui/context"

export function promptReferenceComment(context: Context, options: DialogPromptOptions, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<string | undefined>(resolve => {
    let settled = false
    const finish = (value?: string, close = false) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", abort)
      resolve(value)
      if (close) context.ui.dialog.clear()
    }
    const abort = () => finish(undefined, true)
    context.ui.dialog.show(() => {
      let input: TextareaRenderable
      const dimensions = useTerminalDimensions()
      const limit = () => Math.max(1, Math.min(18, dimensions().height - 14))
      const theme = context.theme
      onMount(() => input.focus())
      context.keymap.layer(() => ({
        commands: [{ bind: "ctrl+c", run: () => finish(undefined, true) }],
      }))
      return (
        <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
          <text fg={theme.text.base}>{options.title}</text>
          <box backgroundColor={theme.background.raised.high} paddingLeft={1} paddingRight={1}>
            <textarea
              ref={node => { input = node }}
              initialValue={options.value ?? ""}
              placeholder={options.placeholder}
              height="auto"
              minHeight={Math.min(3, limit())}
              maxHeight={limit()}
              flexShrink={1}
              wrapMode="word"
              textColor={theme.text.base}
              backgroundColor={theme.background.raised.high}
              focusedBackgroundColor={theme.background.raised.high}
              placeholderColor={theme.text.muted}
              cursorColor={theme.text.base}
              keyBindings={[
                { name: "return", action: "submit" },
                { name: "return", shift: true, action: "newline" },
              ]}
              onSubmit={() => finish(input.plainText, true)}
            />
          </box>
          <box flexDirection="row" flexWrap="wrap" gap={2}>
            <text fg={theme.text.action.primary.selected} onMouseUp={() => finish(input.plainText, true)}>enter continue</text>
            <text fg={theme.text.muted}>shift+enter newline</text>
            <text fg={theme.text.muted} onMouseUp={() => finish(undefined, true)}>esc cancel</text>
          </box>
        </box>
      )
    }, () => finish())
    context.ui.dialog.set({ size: "large", centered: false })
    signal.addEventListener("abort", abort, { once: true })
  })
}
