# Releasing Inbox RS

This is the runbook for cutting a release. The goal is to capture the
*why* behind each step so future maintainers don't have to reverse-engineer
the workflow from `release.yml`.

## What "a release" produces

A single release run produces five things, all triggered from one
`workflow_dispatch` of `.github/workflows/release.yml`:

1. **A version-bump commit** on `master` (e.g. `release v2.1.2`).
2. **A signed git tag** (`v2.1.2`) pushed to GitHub.
3. **A web app deploy** to 5apps (the production hosting at
   `inbox-rs.5apps.com`).
4. **Versioned plugin artifacts** bundled into the web app's `dist/` and
   served from `inbox-rs.5apps.com/downloads/`:
   - `inbox-rs-chromium-<extVer>.zip`
   - `inbox-rs-firefox-<extVer>.xpi`
   - `inbox-rs-thunderbird-<tbVer>.xpi`
5. **A GitHub Release** with auto-generated notes.

Importantly: the build-output commit (with all the `dist/` artifacts) is
**not** pushed to `master`. It lives only on a throwaway `deploy/v<ver>`
branch that gets force-pushed to 5apps and then discarded. `master` only
ever sees clean version-bump commits.

## How to run a release

```bash
# from anywhere with `gh` authed:
gh workflow run release.yml -f bump=patch     # 2.1.1 -> 2.1.2
gh workflow run release.yml -f bump=minor     # 2.1.1 -> 2.2.0
gh workflow run release.yml -f bump=major     # 2.1.1 -> 3.0.0
```

That's it. Don't bump versions locally — the workflow does it.

The workflow refuses to run unless [`ci.yml`](../.github/workflows/ci.yml)
has already passed for the commit on `master` you're releasing. If it
hasn't, push `master` again or manually re-run CI, then retry. This gate
is intentional: a failed release mid-deploy is much harder to clean up
than a failed CI run pre-release.

## Version model

Inbox RS ships **three independent version namespaces**:

| Surface | Version source | When does it move? |
|---|---|---|
| Web app (root, `packages/web`, `packages/rs-module`, `scripts`) | Root `package.json` | **Every release.** The web app *is* the release. |
| Browser extension (`packages/extension`) | `packages/extension/package.json` + manifests | Only when the extension's effective bundle changes. |
| Thunderbird extension (`packages/thunderbird`) | `packages/thunderbird/package.json` + manifest | Only when the Thunderbird extension's effective bundle changes. |

The web app version always tracks the root. The two extension versions
**lag the root** when their bundle hasn't changed. This is on purpose:
each extension store (Chrome Web Store / AMO / Thunderbird ATN) rejects
re-uploading a different artifact under an existing version, so burning
extension version numbers on web-only releases costs us version space
we can't reuse later.

### What counts as "the extension's effective bundle changed"

[`scripts/release-bump.mjs`](../scripts/release-bump.mjs) decides this on
every release, by `git diff`-ing against the previous tag.

| Change since previous tag | Chromium + Firefox | Thunderbird |
|---|---|---|
| `packages/web/**` only | pinned | pinned |
| `packages/extension/**` | **bumps** | pinned |
| `packages/thunderbird/**` | pinned | **bumps** |
| `packages/rs-module/**` (shared dep — both extensions bundle it) | **bumps** | **bumps** |
| `package-lock.json` (any change — see below) | **bumps** | **bumps** |
| Root config / docs / `.github/` / `scripts/` | pinned | pinned |

#### Why the lockfile counts

`npm ci` runs at the start of the release workflow, *before* the
extensions get built. The extensions bundle three caret-pinned libs
(`webextension-polyfill`, `remotestoragejs`, `rs-migrate`), so a routine
`npm audit fix` or `npm update` can re-resolve any of those to a newer
patch — touching only `package-lock.json`. That changes the bytes
inside the resulting `.zip`/`.xpi`. If we left the manifest version
pinned in that case, the new artifact would collide with the old one
on every store and the publish step would fail.

So the policy is **conservative**: any `package-lock.json` change bumps
both extension versions. Yes, this over-bumps when the lockfile change
only affected web-only deps. Burning one extension version is far
cheaper than a failed publish. Fix would be parsing the lockfile diff
to figure out which workspaces' resolutions actually changed — a real
amount of work for a marginal gain. Not worth it today.

### What the policy is enforced by

- [`scripts/release-bump.test.mjs`](../scripts/release-bump.test.mjs) —
  unit tests for `classifyChanges` and `planBumps` covering every
  scenario in the table above. If you change the bump rules, change
  these tests in lockstep.
- [`scripts/gen-plugin-metadata.test.mjs`](../scripts/gen-plugin-metadata.test.mjs) —
  unit tests for the generated `plugin-downloads.generated.ts` shape.
  Pins that the URL filename version matches the per-artifact version
  label (so the downloads page doesn't 404).

## Workflow stages, in order

This is what `release.yml` actually does:

1. **Preflight gate** — `gh run list` against `ci.yml` for the current
   `master` SHA. If CI hasn't passed, exit non-zero before doing anything.
2. **`npm ci`** + `npm install @rollup/rollup-linux-x64-gnu --no-save`
   (the rollup native bin workaround — see [npm/cli#4828](https://github.com/npm/cli/issues/4828)).
3. **Bump root version** — `npm version <bump> --no-git-tag-version`.
4. **Bump per-package versions** — `node scripts/release-bump.mjs $VERSION`.
   This is the policy enforcement step. It writes new versions to:
   - Always: root + `packages/web` + `packages/rs-module` + `scripts`.
   - Conditionally (per the table above): `packages/extension/{package.json,manifest.json,manifest.firefox.json}`,
     `packages/thunderbird/{package.json,manifest.json}`.
5. **Commit + tag + push** — `git add -u`, `git commit -m "release vX.Y.Z"`,
   `git tag vX.Y.Z`, `git push origin HEAD:master --tags`.
6. **Build the web app** — `npm run build`. The web build's `prebuild`
   hook calls `package-plugins.mjs`, which:
   - Builds `rs-module`, then the chromium, firefox, and thunderbird
     extensions.
   - Zips each into `packages/web/public/downloads/inbox-rs-<surface>-<ver>.<ext>`
     using **the surface's own version**, not the root version.
   - Calls `gen-plugin-metadata.mjs`, which regenerates
     `packages/web/src/lib/plugin-downloads.generated.ts` so the web app's
     `<PluginsPage />` links to the right artifact filenames.
7. **5apps deploy** — force-add `packages/web/dist`, commit on a throwaway
   `deploy/v<ver>` branch, `git subtree split --prefix=packages/web/dist`,
   then `git push 5apps <sha>:refs/heads/master --force`. The deploy
   commit is never pushed to `origin`.
8. **GitHub Release** — `gh release create v<ver> --generate-notes`.

Steps 5 and 7 are the only steps that touch remotes. If the workflow
fails before step 5, no remote changes have happened — just retry. If
it fails after step 5, the tag is on GitHub but the deploy is incomplete;
see "Recovery" below.

## Verifying a release

### Before triggering

Look at what's changed since the last tag and predict what the bump
policy will do. The diff that matters is the same one the script will
run against:

```bash
# Last released tag.
PREV=$(git describe --tags --abbrev=0)
echo "previous: $PREV"

# What changed since then?
git diff --stat "$PREV..HEAD"

# Just the file list, broken down by package — this is what
# classifyChanges sees:
git diff --name-only "$PREV..HEAD"
```

Then mentally apply the table above. If you want a programmatic check,
the unit tests already do it: `npm test --workspace=scripts` covers every
scenario in the policy table.

### After it lands

1. **Tag visible** — `git fetch --tags && git tag --list 'v*' | tail -3`.
2. **Web deploy live** — `curl -I https://inbox-rs.5apps.com/` → 200.
3. **Downloads work** — visit `https://inbox-rs.5apps.com/plugins`,
   click each download link. Filenames should match the manifest
   versions you'll see when loading the extension.
4. **Manifest versions match downloads** — `unzip -p path/to/inbox-rs-chromium-X.Y.Z.zip manifest.json | grep version`.

## Recovery

### "Workflow failed at the build step"

No remote state changed yet (the version-bump commit goes out *before*
the build, *with* the tag, in step 5; the build runs in step 6). If the
build fails, the bump commit + tag are already on `origin/master`. To
unwind:

```bash
git fetch --tags
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
git revert <bump-sha> -m "revert release vX.Y.Z (build failed)"
git push origin master
```

Then fix whatever broke the build and try again.

### "Web deploy failed but tag is up"

The 5apps push is force-and-throwaway, so re-running just the deploy
isn't possible from the workflow today. Easiest recovery: trigger a new
patch release. Yes, that burns a version number on top of the failed one,
but the alternative is manually replicating the subtree-split-and-push
logic locally, which is risky.

### "Store rejected the new extension upload"

The most likely cause is the lockfile case described above hitting a
hole in the policy (or someone manually edited a manifest to a colliding
version). Diff the new artifact against the previously-published one:

```bash
unzip -d /tmp/old <old-published>.zip
unzip -d /tmp/new <new-built>.zip
diff -ru /tmp/old /tmp/new | head -50
```

If the diff is meaningful, the manifest version *should* have moved —
either fix the bump policy (see `release-bump.mjs`) and re-release, or
manually bump and re-tag.

## Things deliberately not done

- **No automated upload to extension stores.** Each store has its own
  review cycle and credentials; uploads are manual. The release workflow
  only produces the artifacts and serves them at `/downloads/`.
- **No npm publish.** All workspaces are `"private": true`. `rs-module`
  is consumed only by other workspaces in this repo.
- **No changelog generation.** GitHub Release notes are auto-generated
  from PR titles via `gh release create --generate-notes`. If you want
  a curated changelog, edit the release after the workflow finishes.
- **No version-bump approval gate.** `workflow_dispatch` requires write
  access to the repo, which is the gate. Anyone with write can release.
