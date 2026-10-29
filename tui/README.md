# Annotate TUI

The terminal reviewer is an owned component of **OpenCode Annotate**. Source, tests,
builds and releases live in this repository; `tui/` is an ordinary subfolder.

## Source and build

- `src/`: terminal UI, Markdown layout, source mapping, comments, selection and export.
- `schema/`: annotation types and anchor resolution.
- `hosts/`: local transcript readers used by standalone review commands.
- `tests/`: command-line integration tests; unit tests live alongside the Rust modules.
- `binary.mjs`: one package-relative executable resolver shared by OpenCode and AGY.

From the repository root (Rust 1.96+ and Node 22+):

```sh
npm run build:tui
npm run check:tui
node tui/run.mjs --version
node tui/run.mjs document.md
```

Builds land in `tui/bin/<platform>-<arch>/annotate-tui` (`.exe` on Windows). The npm release
contains all supported executables; normal use needs neither Cargo nor another TUI install.
CI builds and tests macOS arm64/x64, Linux x64/arm64 and Windows x64 from these sources.
Linux x64 and arm64 target Ubuntu 22.04/glibc 2.35+.
Windows native tests run in CI; the OpenCode terminal handoff still needs Windows validation.

## Configuration and delivery

User layout and key settings live in `~/.config/opencode-annotate/tui.toml`
(`%APPDATA%/opencode-annotate/tui.toml` on Windows). A comfortable layout:

```toml
[ui]
horizontal_margin = 2
max_width = 168
doc_width = 120
```

Hosted reviews write their send intent for the adapter: `q` sends notes and returns,
`Ctrl+S` also saves an open comment, and `Ctrl+C` returns to the adapter's confirmation.
The adapters own session targeting and delivery. Markdown labels such as `**题库：**把`
render in bold while selections still map to original source bytes.

The `PLANNOTATOR_*` environment names, internal library identifiers and annotation JSON
keys remain stable so existing retained drafts can be recovered. They do not fetch or
load anything from another project. `PLANNOTATOR_TUI_CONFIG` selects a private per-review
theme copy; the user's file stays intact.

Standalone annotation data defaults to `~/.local/share/opencode-annotate/tui`
(`%LOCALAPPDATA%/opencode-annotate/tui` on Windows). Hosted reviews use their own private
snapshot stores. An explicit `PLANNOTATOR_DATA_DIR` can still open a retained older draft.

## Ownership and provenance

This code was imported from the customized Plannotator TUI 0.9.4 codebase at source commit
`7615edea2fd2648ebaeaec50c1c75940408f361b`, including theme, viewport, input-method, send-key
and Markdown fixes. Subsequent development belongs here. There is no upstream remote,
submodule, registry dependency on Plannotator, download step or update/sync relationship.
Normal third-party Rust libraries are pinned in `Cargo.lock`.

Original MIT copyright and permission notices are preserved in [LICENSE](LICENSE).
Import provenance and the ownership decision are recorded in [sources.json](../sources.json).

| Date | Decision | Basis |
|---|---|---|
| 2026-10-28 | Own the terminal reviewer inside `opencode-annotate/tui/`; build and distribute it with the plugin. | `tui-ownership-decision` in the source register. |

The integrated reviewer first shipped in **0.10.0**, with successful native CI on all
five supported platforms and verified npm executable bytes. Isolated OpenCode reviews
passed with theme inheritance, one-key sends, cancellation and captured-session delivery.
The redundant reviewer repository and local checkout were removed on 2026-10-29 after
publication verification; recoverable history is retained privately. `tui/` is the sole
maintained source. Releases follow the repository's [release process](../docs/releasing.md).
