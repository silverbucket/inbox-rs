#!/bin/bash
# Manual release & deploy script.
# Usage: ./scripts/deploy.sh v<version>  (e.g. ./scripts/deploy.sh v1.2.0)
#
# This script:
#   1. Bumps version files and commits a clean release commit to master.
#   2. Builds the web app (produces packages/web/dist/).
#   3. Force-adds dist/ on a throwaway deploy branch and pushes just that
#      subtree to the 5apps remote — dist/ never lands on origin/master.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Error: Version is required." >&2
  echo "Usage: $0 v<version>" >&2
  exit 1
fi

VERSION="$1"
if [[ "$VERSION" != v* ]]; then
  VERSION="v${VERSION}"
fi
BARE_VERSION="${VERSION#v}"

# ── 1. Ensure we're on a clean master ────────────────────────────────────────
git checkout master
git pull

# ── 2. Bump versions ─────────────────────────────────────────────────────────
npm version "$BARE_VERSION" --no-git-tag-version

for pkg in packages/*/package.json; do
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('$pkg','utf8'));
    p.version = '$BARE_VERSION';
    fs.writeFileSync('$pkg', JSON.stringify(p, null, 2) + '\n');
  "
done

for manifest in packages/extension/manifest.json packages/extension/manifest.firefox.json packages/thunderbird/manifest.json; do
  node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('$manifest','utf8'));
    m.version = '$BARE_VERSION';
    fs.writeFileSync('$manifest', JSON.stringify(m, null, 2) + '\n');
  "
done

# ── 3. Commit version bump + tag — NO build artifacts on master ───────────────
git add package.json packages/*/package.json \
  packages/extension/manifest.json \
  packages/extension/manifest.firefox.json \
  packages/thunderbird/manifest.json
git commit -m "release ${VERSION}"
git tag "${VERSION}"
git push --set-upstream origin master --tags

# ── 4. Build ─────────────────────────────────────────────────────────────────
npm install
npm run build

# Preserve immutable assets used by any older installed shell, then verify the
# stable loader and its release manifest before publishing the new tree.
git fetch 5apps master
node scripts/retain-deployed-web-assets.mjs 5apps/master
node scripts/check-web-deploy.mjs

# ── 5. Deploy to 5apps via throwaway branch (dist/ stays off master) ─────────
git checkout -b "deploy/${VERSION}"
git add packages/web/dist -f
git commit -m "deploy ${VERSION} [skip ci]"

git subtree push --prefix=packages/web/dist 5apps master

# Return to master; the deploy branch is local-only.
git checkout master
git branch -D "deploy/${VERSION}"

echo ""
echo "✓ ${VERSION} deployed. No build artifacts were pushed to origin/master."
