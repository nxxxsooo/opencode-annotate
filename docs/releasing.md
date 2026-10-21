# Releasing

## Package identity

OpenCode Annotate publishes as `@nxxxsooo/opencode-annotate` from
`nxxxsooo/opencode-annotate`. Versions 0.4.2 and earlier were published as
`opencode-plannotator-tui`, which is now deprecated with a pointer to the new name.
The unscoped npm name `opencode-annotate` belongs to an unrelated package.

To switch a maintainer installation from a local checkout back to npm, run
`node scripts/install-plugin.mjs --undo <cli-before.json>` with the private backup under
`.local/migration/`, or replace the checkout path in `cli.json` with
`@nxxxsooo/opencode-annotate@latest`. Reopen the terminal client.

The npm package, Git tag and GitHub Release use the same semver. The maintained
source is this repository; OpenCode installs the published npm artifact.

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
No npm token belongs in the workflow or repository. The bootstrap release is not
evidence that OIDC publication has been exercised; verify that on the next release.

## Subsequent releases

1. Review the worktree and run `npm run check` plus `npm run test:smoke` for runtime changes.
2. Bump `package.json` and `package-lock.json`, and update `CHANGELOG.md`.
3. Commit the exact release state and create its `v<version>` tag. Push the branch and tag.
4. Watch `publish.yml`. It validates the tag, runs checks and publishes through OIDC.
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

Never overwrite a published tag or version. If publication fails, diagnose the
specific surface and retry only an idempotent step. Completion requires the source,
Release, registry version and maintainer installation to agree.
