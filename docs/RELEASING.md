# Releasing Inbox RS

## TL;DR

```bash
gh workflow run release.yml -f bump=patch    # or minor / major
```

Don't bump versions locally. The workflow refuses to run unless
[`ci.yml`](../.github/workflows/ci.yml) is green for the current `master`
SHA — fix CI first, then retry.

## What a release produces

- Version-bump commit on `master` (e.g. `release v2.1.2`).
- Tag `v2.1.2`.
- Web app deploy to [`inbox.5apps.com`](https://inbox.5apps.com).
- Versioned plugin artifacts at `inbox.5apps.com/downloads/`:
  `inbox-rs-chromium-<extVer>.zip`, `inbox-rs-firefox-<extVer>.xpi`,
  `inbox-rs-thunderbird-<tbVer>.xpi`.
- GitHub Release with auto-generated notes.

The build commit (with `dist/`) is force-pushed to 5apps from a throwaway
`deploy/v<ver>` branch and never reaches `origin`. `master` only sees
clean version-bump commits.

## Version model

Three independent versions:

| Surface | Source of truth | Moves when |
|---|---|---|
| Web app (root, `packages/web`, `packages/rs-module`, `scripts`) | Root `package.json` | Every release |
| Browser extension (`packages/extension`) | `packages/extension/package.json` + manifests | Anything under its package, `rs-module`, or the lockfile changed |
| Thunderbird extension (`packages/thunderbird`) | `packages/thunderbird/package.json` + manifest | Anything under its package, `rs-module`, or the lockfile changed |

Extensions lag the root on web-only releases. This is on purpose: each
extension store (Chrome Web Store / AMO / Thunderbird ATN) rejects
re-uploading a different artifact under an existing version.

### What counts as a change

[`scripts/release-bump.mjs`](../scripts/release-bump.mjs) decides per
release by `git diff`-ing against the previous tag. The check is on **paths**,
not on the content of the built artifact: `classifyChanges` asks whether any
changed path starts with `packages/extension/`, `packages/thunderbird/` or
`packages/rs-module/`, plus an exact match on `package-lock.json`.

| Change since previous tag | Chromium + Firefox | Thunderbird |
|---|---|---|
| `packages/web/**` only | pinned | pinned |
| `packages/extension/**` | bumps | pinned |
| `packages/thunderbird/**` | pinned | bumps |
| `packages/rs-module/**` | bumps | bumps |
| `package-lock.json` | bumps | bumps |
| Root config / docs / `.github/` / `scripts/` | pinned | pinned |

Because it matches on paths, a change that can't reach the shipped
artifact still bumps: editing only `packages/extension/src/*.test.ts`
burns an extension version on a byte-identical ZIP. That over-bump is
deliberate — a wasted version number is recoverable, a store rejecting a
changed artifact under an existing version is not.

The policy is exercised by
[`scripts/release-bump.test.mjs`](../scripts/release-bump.test.mjs) — if
you change the rules, change the tests in lockstep.

#### Why the lockfile counts

`npm ci` runs before the extensions get built. The extensions bundle
caret-pinned libs (`webextension-polyfill`, `remotestoragejs`,
`rs-migrate`), so a routine `npm audit fix` can re-resolve any of them
and produce a different `.zip`/`.xpi` without touching a source file.
Treating any lockfile change as extension-affecting over-bumps in the
case of web-only deps; that's still cheaper than a failed publish.

## Workflow stages

1. **Preflight** — refuse to release unless CI passed for the current SHA.
2. **`npm ci`** + the rollup native-bin workaround.
3. **Bump root** — `npm version <bump> --no-git-tag-version`.
4. **Bump per-package** — `node scripts/release-bump.mjs $VERSION`
   (the policy table above).
5. **Commit + tag + push to `master`.**
6. **Build the web app** — `npm run build`. Its `prebuild` hook builds
   each extension, zips it under its own version, and regenerates
   `packages/web/src/lib/plugin-downloads.generated.ts`.
7. **Deploy to 5apps** — `git subtree split` on `packages/web/dist`,
   force-push to the `5apps` remote.
8. **GitHub Release** — `gh release create v<ver> --generate-notes`.

Steps 5 and 7 are the only ones that touch remotes.

## Verifying

### Before triggering

```bash
PREV=$(git describe --tags --abbrev=0)
git diff --stat "$PREV..HEAD"
git diff --name-only "$PREV..HEAD"
```

Apply the policy table to the second list. For mechanical confirmation:
`npm test --workspace=scripts`.

### After it lands

- `git fetch --tags && git tag --list 'v*' | tail -3` — new tag visible.
- `curl -I https://inbox.5apps.com/` — 200.
- Visit `inbox.5apps.com/plugins`, click each download — files exist.
- `unzip -p inbox-rs-chromium-X.Y.Z.zip manifest.json | grep version` —
  matches the filename.

## Recovery

**Build step failed (after the tag pushed).** The bump commit + tag are
already on `origin`. Unwind:

```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
git revert <bump-sha> -m "revert release vX.Y.Z (build failed)"
git push origin master
```

**5apps deploy failed but tag is up.** Trigger a new patch release.
Reproducing the subtree-split-and-force-push manually is risky.

**Store rejected an extension upload.** Likely a hole in the bump
policy. Diff the new artifact against the previously-published one
(`unzip -d /tmp/old`, `unzip -d /tmp/new`, `diff -ru`); if the diff is
real, fix `release-bump.mjs` and re-release.

## Not done

- No automated store uploads — Chrome Web Store / AMO / ATN are manual.
- No npm publish — every workspace is `"private": true`.
- No curated changelog — GitHub Release notes are generated from PR
  titles. Edit the release if you want better copy.
- No extra approval gate — `workflow_dispatch` already requires write
  access.
