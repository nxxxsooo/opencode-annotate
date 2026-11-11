#!/bin/sh
# Run from the repository root after extracting the published package into .local/demo-release.
set -eu
mkdir -p .local/demo-terminal
stty size > .local/demo-terminal/terminal-size.txt
rm -rf .local/demo-terminal/data
unset PLANNOTATOR_TUI_INPUT_SOURCE PLANNOTATOR_TUI_TEXT_INPUT_SOURCE
unset PLANNOTATOR_TUI_SEND_INTENT PLANNOTATOR_FEEDBACK_HISTORY PLANNOTATOR_ORIGIN
export PLANNOTATOR_DATA_DIR="$PWD/.local/demo-terminal/data"
export PLANNOTATOR_TUI_CONFIG="$PWD/scripts/demo/tui.toml"
export PLANNOTATOR_TUI_THEME=dark
exec node .local/demo-release/package/tui/run.mjs scripts/demo/review-plan.md
