/**
 * Per-package version bumping for the release workflow.
 *
 * The web app and rs-module always track the root `package.json` version —
 * the web app *is* the release, and rs-module is an internal lib whose
 * version is just a label.
 *
 * The browser extensions and Thunderbird add-on are different: each
 * version bump produces an artifact that has to be re-uploaded to a store
 * (Chrome Web Store / AMO / Thunderbird ATN). Stores reject re-uploads of
 * an existing version, so burning a version number on a no-op release
 * costs us a real version we can't reuse later. This script bumps each
 * extension only when its effective bundle has actually changed since the
 * previous tag — that is, when something under its package directory or
 * the shared rs-module changed.
 *
 * Usage (called from .github/workflows/release.yml):
 *   node scripts/release-bump.mjs <new-version>
 *
 * The pure functions `classifyChanges` and `planBumps` are exported for
 * unit tests so we don't have to spin up fixture git repos.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');

/**
 * Decide which extensions need a version bump given the list of paths
 * changed since the previous release tag.
 *
 * - rs-module changes propagate to BOTH extensions (they bundle it).
 * - Lockfile changes propagate to BOTH extensions: `npm ci` runs before
 *   the extension build, so a lockfile-only update (`npm audit fix`,
 *   transitive resolution refresh, etc.) can bump bundled libs like
 *   `webextension-polyfill`/`remotestoragejs` and produce a different
 *   ZIP/XPI under an unchanged manifest version. Stores reject that;
 *   conservatively treating any lockfile change as extension-affecting
 *   is far cheaper than a failed publish.
 * - Pure web-only or root-only changes (docs, .github/, scripts/, etc.)
 *   bump nothing extension-wise.
 *
 * Pure function — no I/O — so tests can call it with synthetic file lists.
 */
export function classifyChanges(changedFiles) {
  const inRsModule = changedFiles.some((f) =>
    f.startsWith('packages/rs-module/'),
  );
  const inExtension = changedFiles.some((f) =>
    f.startsWith('packages/extension/'),
  );
  const inThunderbird = changedFiles.some((f) =>
    f.startsWith('packages/thunderbird/'),
  );
  const inLockfile = changedFiles.some((f) => f === 'package-lock.json');
  return {
    rsModuleChanged: inRsModule,
    lockfileChanged: inLockfile,
    extensionNeedsBump: inRsModule || inExtension || inLockfile,
    thunderbirdNeedsBump: inRsModule || inThunderbird || inLockfile,
  };
}

/**
 * Build the list of `{ file, version }` updates that should be written
 * to disk for a given new version + classification.
 *
 * Pure function — no I/O.
 */
export function planBumps(newVersion, classification) {
  const plan = [
    { file: 'package.json', version: newVersion },
    { file: 'packages/web/package.json', version: newVersion },
    { file: 'packages/rs-module/package.json', version: newVersion },
    { file: 'scripts/package.json', version: newVersion },
  ];
  if (classification.extensionNeedsBump) {
    plan.push(
      { file: 'packages/extension/package.json', version: newVersion },
      { file: 'packages/extension/manifest.json', version: newVersion },
      { file: 'packages/extension/manifest.firefox.json', version: newVersion },
    );
  }
  if (classification.thunderbirdNeedsBump) {
    plan.push(
      { file: 'packages/thunderbird/package.json', version: newVersion },
      { file: 'packages/thunderbird/manifest.json', version: newVersion },
    );
  }
  return plan;
}

/**
 * List files that changed in the working tree since `prevTag`. Returns an
 * empty array when `prevTag` is empty (initial release — caller should
 * treat this as "everything changed").
 */
export function changedFilesSince(prevTag, gitCwd = rootDir) {
  if (!prevTag) return [];
  const out = execFileSync('git', ['diff', '--name-only', `${prevTag}..HEAD`], {
    cwd: gitCwd,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Look up the most recent tag reachable from HEAD's first parent. */
export function previousTag(gitCwd = rootDir) {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', 'HEAD^'], {
      cwd: gitCwd,
      encoding: 'utf8',
    }).trim();
  } catch {
    // No tag yet (initial release).
    return '';
  }
}

/** Set `version` in a JSON file in-place. Biome formats it afterwards. */
function setVersionInFile(absPath, version) {
  const json = JSON.parse(readFileSync(absPath, 'utf8'));
  json.version = version;
  writeFileSync(absPath, `${JSON.stringify(json, null, 2)}\n`);
}

function formatFiles(files) {
  execFileSync('npx', ['biome', 'format', '--write', ...files], {
    cwd: rootDir,
    stdio: 'inherit',
  });
}

/** CLI entrypoint. Logs every bump (and every skip) so release logs are readable. */
export function main(argv = process.argv) {
  const newVersion = argv[2];
  if (!newVersion) {
    console.error('Usage: node scripts/release-bump.mjs <new-version>');
    process.exit(1);
  }

  const prevTag = previousTag();
  const changedFiles = changedFilesSince(prevTag);

  let classification;
  if (!prevTag) {
    // Initial release: bump everything.
    console.log(
      '[release-bump] no previous tag found — initial release, bumping everything',
    );
    classification = {
      rsModuleChanged: true,
      lockfileChanged: true,
      extensionNeedsBump: true,
      thunderbirdNeedsBump: true,
    };
  } else {
    classification = classifyChanges(changedFiles);
    console.log(`[release-bump] previous tag: ${prevTag}`);
    console.log(
      `[release-bump] rs-module changed: ${classification.rsModuleChanged}`,
    );
    console.log(
      `[release-bump] lockfile changed:  ${classification.lockfileChanged}`,
    );
    console.log(
      `[release-bump] extension bump:    ${classification.extensionNeedsBump}`,
    );
    console.log(
      `[release-bump] thunderbird bump:  ${classification.thunderbirdNeedsBump}`,
    );
  }

  if (!classification.extensionNeedsBump) {
    console.log(
      '[release-bump] extension version pinned — no changes to packages/extension/, packages/rs-module/, or package-lock.json',
    );
  }
  if (!classification.thunderbirdNeedsBump) {
    console.log(
      '[release-bump] thunderbird version pinned — no changes to packages/thunderbird/, packages/rs-module/, or package-lock.json',
    );
  }

  const plan = planBumps(newVersion, classification);
  for (const { file, version } of plan) {
    setVersionInFile(join(rootDir, file), version);
    console.log(`[release-bump] ${file} → ${version}`);
  }

  formatFiles(plan.map(({ file }) => file));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
