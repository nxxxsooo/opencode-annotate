# Releasing

## 0.10.1 release baseline — 2026-10-29

This patch combines automatic long-reply review with the accepted blank-home browser
pairing fix. `/annotate-web` can create an empty session using the current directory
and selected model, then receive the first review without a seed prompt. Automatic
review is opt-in; opening or pairing a review never starts a model turn.

| Surface | Release contract |
|---|---|
| Source | Push the exact accepted fix on `main`; require its five native builds and package CI to pass before tagging. |
| GitHub Release | Publish `v0.10.1` at that verified commit, with the matching changelog and install/update commands. |
| npm | Publish `@nxxxsooo/opencode-annotate@0.10.1` through `publish.yml`; verify `latest`, provenance, package files and all five native executables against the release build. |
| Maintainer install | Replace the checkout package value with the npm source, preserving options; verify the installed version and run the published package in isolated smoke sessions. |
| Local checks | 80 Node tests, Rust formatting/Clippy/workspace tests, and 21 real OpenCode smoke scenarios passed, including blank-home creation, first browser-note delivery and revocation. The maintainer also tested and accepted the fix. |
| Previous release | `v0.10.0` remains at `67cd250bef6139991f947331f0e5117f12f1e95e`, containing the owned TUI and conversation references. |
| Retirement | The separate reviewer repository and former checkout were removed after 0.10.0 verification; `tui/` is maintained here with its original MIT notice. |

The version-specific delivery receipt in `.local/releases/0.10.1-state.json` records
the exact commit, CI and publish runs, registry integrity, installed source and smoke
evidence. Publishing and local installation must each be verified before marking it complete.

| Decision | Basis |
|---|---|
| Keep automatic review in the 0.10 series; use the pending 0.10.1 for this fix. | `auto-review-release-series` in [`sources.json`](../sources.json). |
| Ship the blank-home fix after real user testing. | `blank-home-web-acceptance` in [`sources.json`](../sources.json). |

Published tags and npm versions remain immutable. The intermediate `0.11.0`
preparation was superseded before publication.

Private recovery material lives under `.local/retired/20261029-plannotator-tui/` (verified
Git bundle, retained local-only evidence and deletion receipt). `.local/releases/` contains
the version-specific status records and prepared `0.10.1-notes.md`.

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
