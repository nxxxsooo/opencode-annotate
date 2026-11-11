# Releasing

## 0.13.0 — auto-sizing reference comments — 2026-11-11

This release adds only the accepted optional `/ref` comment step and its auto-sizing
multiline editor to the 0.12.0 baseline. Long lines wrap; the field grows and shrinks
between three rows and a screen-aware limit (up to 18 rows), then scrolls. Shift+Enter
adds a line, Enter continues to the existing confirmation, and Esc/Ctrl+C cancel.
Comments remain separate from historical quotations. Captured-session targeting,
`delivery: "queue"` and `resume: false` are unchanged.

The mixed development checkout's inline reference annotations, reference-from-home,
automatic continuation, Chrome session picker and command consolidation are excluded.
Distribution is npm `@nxxxsooo/opencode-annotate@0.13.0` (five native executables), tag
and GitHub Release `v0.13.0`. CI and publication retain the native/Safari build gates.
Publishing and the maintainer's local development installation are verified separately;
the latter stays on the checkout so unrelated unpublished work and options are preserved.

Verification and release receipts are recorded privately under `.local/releases/0.13.0/`.

## 0.12.0 release baseline — 2026-11-10

The user authorized one release for the accepted compact TUI toolbar and Safari companion.
The candidate is isolated from the mixed development tree at the 0.11.1 release baseline.
It excludes unpublished reference comments, automatic feedback continuation, the Chrome
connection/session-picker redesign and command consolidation. Existing commands, including
`/annotate-web`, remain supported.

| Surface | Release contract |
|---|---|
| TUI | Four visible actions, Done/Get feedback, explicit-copy confirmation and optional external PNGs. Artwork is one row tall with original action-colored bold shortcuts. No third-party artwork, local settings or machine-specific paths are bundled. |
| Safari | Shared-source, App-Sandboxed copy-only companion; separate panel window and no native messaging/session delivery. Build locally with Xcode and an appropriate signing identity, then install. No signed/notarized Safari app is distributed. |
| Chrome | Published pairing, delivery and commands stay unchanged; only cross-browser capability/targeting adapters are added. |
| Distribution | Source/tag and GitHub Release `v0.12.0`; npm `@nxxxsooo/opencode-annotate@0.12.0` with all five native TUI executables, Safari sources and local build/install scripts. |
| Automation | CI and tag publication both require all five native TUI builds plus an ad-hoc Safari build through Apple's converter and Xcode. No signing identity or notarization credentials enter CI. |
| Local install | Preserve existing OpenCode plugin options and local artwork configuration. Verify published-package installation separately from publication; rebuild/install the Safari companion from the isolated release candidate. |

Release-request evidence: `combined-safari-toolbar-release-20261110` in
[`sources.json`](../sources.json). Safari's prior user acceptance is recorded there;
the extracted candidate passed 403 Rust tests, 97 Node tests, all 33 unchanged Chrome
scenarios, and the isolated OpenCode smoke/reference suites on OpenCode 2.2.7. The 21-scenario
smoke suite also passed with inherited dark and light colors. Fixtures use unique message
IDs and disable the maintainer's unrelated TUI plugin; no model turn is started.
Both ad-hoc and locally signed Safari builds passed, with app/extension metadata at 0.12.0
and App Sandbox enabled. The extracted Safari popup-failure path is regression-tested;
a full repeat of the user's real Safari interaction was not performed for this candidate.

## 0.11.1 release baseline — 2026-11-08

This patch fixes cursor movement in the TUI comment/edit box. Up/Down move by wrapped row
instead of only between typed newlines. Cmd+Left/Right (Super+arrow, Ctrl+A/Ctrl+E, Home/End)
go to the line start or end, Cmd+Up/Down to the comment start or end, and Option+Left/Right
(Alt+B/Alt+F, Ctrl+arrows) by word. Options, key bindings and stored annotations are unchanged.

| Surface | Release contract |
|---|---|
| Source | `2acf3b3` (fix) and `70324dc` (release) on `main`, built from a clean worktree at `3a99fe1` that excluded the unreleased browser, command, `/ref` and `tui/hosts` work; CI run 42390938027 passed all five native builds and package checks. |
| GitHub Release | `v0.11.1` at `70324dcabc25efa7162af9014adff331d319625f`, with the matching changelog and install/update commands. |
| npm | `@nxxxsooo/opencode-annotate@0.11.1` is `latest`, published with signed provenance by `publish.yml` run 42391731478 with `gitHead` `70324dc`. |
| Maintainer install | Still this checkout. `main` was moved to `70324dc` with `git reset --mixed`, keeping the uncommitted work (pre-reset diff in `.local/backups/20261108-pre-0.11.1-checkout.patch`). The checkout cannot build the TUI while `tui/hosts/src/claude/` is deleted but still declared, so `tui/bin/darwin-arm64/annotate-tui` is the release-worktree build (`--version` 0.11.1). |
| Local checks | Rust formatting/Clippy/workspace tests (4 new compose tests), 84 Node tests and the package dry-run passed. A headless tmux run of the built binary confirmed wrapped-row Up, Ctrl+A/Ctrl+E and Alt+B. OpenCode smoke tests were not run; the change is confined to TUI key handling. Real Cmd-key events in Ghostty were not exercised. |
| Previous release | `v0.11.0` at `3db40592b758413e8c102e7817cd0b2a7ebe1cfb` (what? notes and explicit copy). |

The version-specific receipt is `.local/releases/0.11.1-state.json`.

## 0.11.0 release baseline — 2026-11-05

This minor release adds **what?** (`w`) to the TUI selection toolbar and makes copying
explicit. A `what?` note stays short; sent feedback adds one instruction for all of them
(`[prompts] what` in `tui.toml`) and, when OpenCode has the skill, attaches `what`
(`whatSkill` option: another skill ID or `false`). Selecting no longer writes the clipboard;
`y` or **copy** does. Toolbar items wrap in narrow panes.

| Surface | Release contract |
|---|---|
| Source | `14b417b` (feature) and `3db4059` (release) on `main`, built from a clean worktree at `535dace` that excluded the unreleased browser, command and `/ref` work; CI run 41956061750 passed. |
| GitHub Release | `v0.11.0` at `3db40592b758413e8c102e7817cd0b2a7ebe1cfb`, with the matching changelog and install/update commands. |
| npm | `@nxxxsooo/opencode-annotate@0.11.0` is `latest`, published with signed provenance by `publish.yml` run 41956311838 with `gitHead` `3db4059`. |
| Skill | The companion `what` skill in `nxxxsooo/loop` explains annotated `what?` passages; it shipped in loop `v3.4.0` (`596ebe3`), and the maintainer's global loop skills were refreshed to that release. A live OpenCode server resolved the skill attachment into the queued prompt in an isolated session without a model turn. |
| Maintainer install | Still the local checkout in `opencode.jsonc`, which contains this release plus the unreleased work. Switch back to `@nxxxsooo/opencode-annotate@latest` once that work is released or shelved, preserving options. |
| Local checks | 84 Node tests, Rust formatting/Clippy/261 workspace tests, package dry-run and 21 isolated OpenCode smoke scenarios passed. A headless tmux run verified keyboard, mouse, rebinding and narrow-pane toolbar wrapping. On November 6 a real `what?` send from the maintainer's daily session arrived with the `what` skill loaded before the feedback, the quoted passage and one instruction section. |
| Previous release | `v0.10.4` at `11cf77c14f7f55e4bfbc101634bc16de7cb10e71` (interrupted replies). |

The version-specific receipt is `.local/releases/0.11.0-state.json`. The unpublished
October 29 `0.11.0` preparation was superseded by 0.10.1; its records are kept as
`.local/releases/0.11.0-superseded-20261029-*`.

## 0.10.4 release baseline — 2026-11-03

This patch makes an interrupted reply (finish `error` with an `aborted` error, for example
one stopped while a question tool waited) eligible for `/annotate`, `/annotate-pick` and
`/ref`. Real failures and streaming replies stay excluded. It changes no options or protocol.

| Surface | Release contract |
|---|---|
| Source | `08c09d8` (fix) and `11cf77c` (release) on `main`, built from a clean worktree that excluded the unreleased browser-startup work; CI run 41567068146 passed all five native builds and package checks. |
| GitHub Release | `v0.10.4` at `11cf77c14f7f55e4bfbc101634bc16de7cb10e71`, with the matching changelog and install/update commands. |
| npm | `@nxxxsooo/opencode-annotate@0.10.4` is `latest`, published by `publish.yml` run 41567609571 with `gitHead` `11cf77c`. |
| Maintainer install | Not updated from npm: the daily `opencode.jsonc` entry points at this checkout, which already contains the fix plus unreleased work. Switch back to `@nxxxsooo/opencode-annotate@latest` once that work is released or shelved, preserving options. |
| Local checks | Node tests, Rust checks, 21 real OpenCode smoke scenarios and the `/ref` reference smoke passed; `selectReply` accepted the real interrupted message that prompted the fix. |
| Previous release | `v0.10.3` remains at `a3c166b319d64719fac0ffcc76b227f58080cd4e` (long code lines); `v0.10.2` at `3573f37219bfab170b4f6626d95996a42bb0ff90`; `v0.10.1` at `22c9cf932153fbf0bd72702a27fb211cf0f08ea0`; `v0.10.0` at `67cd250bef6139991f947331f0e5117f12f1e95e`. |
| Retirement | The separate reviewer repository and former checkout were removed after 0.10.0 verification; `tui/` is maintained here with its original MIT notice. |

The version-specific delivery receipt in `.local/releases/0.10.4-state.json` records
the exact commit, CI and publish runs, registry integrity, installed source and smoke
evidence. Publishing and local installation must each be verified before marking it complete.

| Decision | Basis |
|---|---|
| Keep automatic review in the 0.10 series; use the pending 0.10.1 for this fix. | `auto-review-release-series` in [`sources.json`](../sources.json). |
| Ship the blank-home fix after real user testing. | `blank-home-web-acceptance` in [`sources.json`](../sources.json). |

Published tags and npm versions remain immutable. The intermediate October 29 `0.11.0`
preparation was superseded before publication; the published 0.11.0 is the November 5 release.

Private recovery material lives under `.local/retired/20261029-plannotator-tui/` (verified
Git bundle, retained local-only evidence and deletion receipt). `.local/releases/` contains
the version-specific status records and prepared release notes (`<version>-notes.md`).

The maintainer options to preserve are `inheritTheme: true`, `autoAnnotate: true`, and
`autoAnnotateThreshold: 2000` in the single `opencode.json(c)` plugin entry. There is no
duplicate CLI entry. Public automatic-review defaults are off and 2,000 Unicode characters,
with a strict greater-than threshold. A published-package install must carry these
local options over rather than reset them.

## Package identity

OpenCode Annotate publishes as `@nxxxsooo/opencode-annotate` from
`nxxxsooo/opencode-annotate`. Versions 0.4.2 and earlier were published as
`opencode-plannotator-tui`, which is now deprecated with a pointer to the new name.
The unscoped npm name `opencode-annotate` belongs to an unrelated package.

To switch the current server-plus-TUI installation from a checkout back to npm, replace
only its `package` value in the existing `opencode.json(c)` entry with
`@nxxxsooo/opencode-annotate@latest`, preserving its options. Update that package and verify
it with `opencode plugin list`; run `/reload` if necessary. Keep one entry, without a
duplicate in `cli.json`. The older `scripts/install-plugin.mjs` helper handles TUI-only
CLI entries and is not the migration path for this combined package.

The npm package, Git tag and GitHub Release use the same semver. The maintained
source is this repository, including the Rust reviewer in `tui/`; OpenCode installs
the published npm artifact with its matching native executables. There is no separate
reviewer repository, release, upstream download or synchronization step.

## Bootstrap

A package name that does not exist on npm yet starts with one direct publish from the
maintainer's terminal. With CI green on a clean commit, run this as one block:

```sh
npm login
npm publish --access public
npm trust github @nxxxsooo/opencode-annotate --file publish.yml --repo nxxxsooo/opencode-annotate --allow-publish --yes
```

For a rename, add `npm deprecate <old-package> "Renamed to <new-package>"`.

npm 12.2 behaves as follows:

- It processes a new package asynchronously. A `0.0.0-stage` placeholder appears at once, and the real version follows a few minutes later.
- `npm view` returns 404 until the real version arrives.
- `npm trust` succeeds right after the publish and grants `publish, stage publish`.

Push the matching tag afterwards. `publish.yml` verifies the bootstrap archive and skips the upload.
This was done for 0.5.0 on 2026-10-21 (trust id `8bb95722`).

Keep publishing protected by 2FA and use OIDC for subsequent automated releases.
No npm token belongs in the workflow or repository. OIDC publication with signed
provenance was first exercised by 0.6.0 on 2026-10-22.

## Subsequent releases

1. Review the worktree. Run `npm run build:tui`, `npm run check:tui`, `npm run check`
   and `npm run test:smoke` for runtime changes.
   Run `npm run test:references` when changing the server tools, history reader or `/ref`.
2. Bump `package.json`, `package-lock.json` and the workspace version in `tui/Cargo.toml`.
   Refresh `tui/Cargo.lock` with Cargo, rebuild, and update `CHANGELOG.md`.
3. Commit the exact release state and create its `v<version>` tag. Push the branch and tag.
4. Watch `publish.yml`. Its reusable `native.yml` builds and tests the same tagged source
   on macOS arm64/x64, Linux arm64/x64 and Windows x64. The publish job collects all five
   executables, restores their executable bits, verifies completeness and the host version,
   then runs package checks and publishes through OIDC. Rust source stays in Git; build
   caches are excluded. The npm allowlist includes native executables, launcher, resolver and license.
5. If that version already exists (for example, the bootstrap), the workflow
   compares published file bytes and executable bits with the local package before
   skipping the upload. Compressed archive checksums can differ between platforms.
6. Verify `npm view @nxxxsooo/opencode-annotate version dist-tags --json`, then create
   the matching GitHub Release with user-facing changes and install/update commands.
7. Refresh the maintainer's installation:

   ```sh
   opencode plugin update @nxxxsooo/opencode-annotate@latest
   opencode plugin list
   ```

    Reopen the terminal client and smoke-test the published package, not only this checkout.

    Releases with the server entrypoint require a single entry in `opencode.json(c)`.
    Move a previous TUI-only entry from `cli.json`, preserving its options, so the same
    package supplies both agent tools and TUI commands. To check a packed artifact locally,
    extract it and run `ANNOTATE_PACKAGE_ROOT=<extracted-package> npm run test:references`.

Never overwrite a published tag or version. If publication fails, diagnose the
specific surface and retry only an idempotent step. Completion requires the source,
Release, registry version and maintainer installation to agree.
