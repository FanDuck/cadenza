# Releasing

Releases are built by GitHub Actions, not on a developer machine.

## Cut a release

1. Bump the version in these four places (they must match):
   - `package.json`
   - `packages/core/package.json`
   - `packages/ui/package.json`
   - `apps/desktop/package.json`
2. Move the `[Unreleased]` notes in `CHANGELOG.md` into a new version heading.
3. Commit, then tag and push:

   ```powershell
   git commit -am "chore(release): v0.2.0"
   git tag v0.2.0
   git push origin main --tags
   ```

4. The [Release workflow](../.github/workflows/release.yml) runs on the tag:
   it installs, runs the test suite, builds the app, then produces:
   - `Cadenza-Setup-<version>.exe` — NSIS installer (per-user, changeable install dir)
   - `Cadenza-<version>-portable.exe` — single executable, nothing to install
   - `Cadenza-<version>-win.zip` — unpacked build
   The files are attached to a GitHub release with generated notes.

## Why not build the installer locally?

`electron-builder` builds the NSIS uninstaller by **executing** the intermediate
installer. That requires an environment where launching that bootstrap is allowed;
some sandboxes and CI-less machines refuse it (`Exit code: 2`). GitHub's Windows
runners can, so the tag workflow is the supported path.

You can still build the portable executable locally:

```powershell
pnpm package
pnpm exec electron-builder --win portable --config apps/desktop/electron-builder.yml
```

## Code signing

The builds are unsigned. Windows SmartScreen shows "Windows protected your PC" on
first run; users click **More info → Run anyway**. If you ever obtain a certificate,
set `CSC_LINK` (base64 of the .pfx) and `CSC_KEY_PASSWORD` as repository secrets and
remove `CSC_IDENTITY_AUTO_DISCOVERY` from the workflow.
