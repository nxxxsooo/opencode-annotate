# Annotate TUI

Owned Rust component of `opencode-annotate`, built from this directory. No nested Git
repository, submodule, external Plannotator package or upstream synchronization.

- `src/`: document parsing, cached layout, source mapping, terminal rendering and input.
- `schema/`: annotation storage and anchor resolution. `hosts/`: local transcript readers.
- Build and verify from the repository root with `npm run build:tui` and `npm run check:tui`.
- Keep annotation byte offsets, snapshot isolation, archived-note recovery, one-key send,
  theme inheritance and input-source restoration intact. The `PLANNOTATOR_*` environment
  names and stored anchor keys are local protocol identifiers, not external connections.
- `pulldown-cmark` and `tui-markdown` parse/render Markdown. The owned same-line bold-label
  adjustment lives in `src/layout.rs`; keep its source-map regressions covered.
- Preserve `LICENSE`. Native executables are built artifacts under `bin/`, excluded from Git.
- Runtime tests use isolated fixture stores and headless terminals; never drive a real user session.
