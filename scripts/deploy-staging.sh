#!/bin/bash
# Manual staging deploy script.
# Usage: ./scripts/deploy-staging.sh [branch]   (defaults to the current branch)
#
# Secondary publishing method — builds the given branch and ships just the web
# app's dist/ to the staging 5apps site (inbox-staging.5apps.com). Unlike
# scripts/deploy.sh this does NOT bump versions, tag, or push anything to
# origin. Nothing about origin/master is touched.

set -euo pipefail

STAGING_REMOTE_URL="git@5apps.com:silverbucket_inbox-rs-staging.git"

# Branch to deploy — argument, or whatever is currently checked out.
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"

# ── 1. Refuse to run on a dirty tree — the deploy commits build artifacts and
#       we don't want to sweep up unrelated local changes. ─────────────────────
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is dirty. Commit or stash your changes first." >&2
  exit 1
fi

# ── 2. Check out the requested branch and fetch its latest state. ─────────────
git checkout "$BRANCH"
git pull --ff-only

# ── 3. Ensure the staging remote exists / points at the right repo. ───────────
git remote add 5apps-staging "$STAGING_REMOTE_URL" 2>/dev/null \
  || git remote set-url 5apps-staging "$STAGING_REMOTE_URL"

# ── 4. Build. STAGING_BUILD=1 turns on sourcemaps + the __STAGING__ debug flag
#       (see packages/web/vite.config.ts). ──────────────────────────────────────
npm install
STAGING_BUILD=1 npm run build

# Preserve immutable assets used by any older installed shell, then verify the
# stable loader and its release manifest before publishing the new tree.
git fetch 5apps-staging +refs/heads/master:refs/remotes/5apps-staging/master
node scripts/retain-deployed-web-assets.mjs 5apps-staging/master
node scripts/create-deployed-entry-shims.mjs 5apps-staging/master
node scripts/check-web-deploy.mjs

# ── 5. Deploy to staging via a throwaway branch (dist/ never lands on origin) ─
DEPLOY_BRANCH="staging-deploy/${BRANCH//\//-}"
git branch -D "$DEPLOY_BRANCH" 2>/dev/null || true
git checkout -b "$DEPLOY_BRANCH"
git add packages/web/dist -f
git commit -m "deploy ${BRANCH} to staging [skip ci]"

SPLIT_SHA=$(git subtree split --prefix=packages/web/dist)
git push 5apps-staging "$SPLIT_SHA":refs/heads/master --force

# Return to the original branch; the deploy branch is local-only.
git checkout "$BRANCH"
git branch -D "$DEPLOY_BRANCH"

echo ""
echo "✓ ${BRANCH} deployed to staging (inbox-staging.5apps.com). Nothing was pushed to origin."
