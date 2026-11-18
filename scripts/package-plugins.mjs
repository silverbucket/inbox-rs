import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveDirectory } from './plugin-archive.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');

const extensionDir = join(rootDir, 'packages', 'extension');
const thunderbirdDir = join(rootDir, 'packages', 'thunderbird');
const downloadsDir = join(rootDir, 'packages', 'web', 'public', 'downloads');

// Each extension's artifact filename uses its OWN version (from its own
// package.json), not the root web-app version. This is what lets the
// release workflow ship a new web release without re-versioning unchanged
// extensions — see scripts/release-bump.mjs.
function readVersion(pkgJson) {
  return JSON.parse(readFileSync(pkgJson, 'utf8')).version;
}

const extensionVersion = readVersion(join(extensionDir, 'package.json'));
const thunderbirdVersion = readVersion(join(thunderbirdDir, 'package.json'));

const artifactNames = {
  chromium: `inbox-rs-chromium-${extensionVersion}.zip`,
  firefox: `inbox-rs-firefox-${extensionVersion}.xpi`,
  thunderbird: `inbox-rs-thunderbird-${thunderbirdVersion}.xpi`,
};

function runBun(args, env = {}) {
  execFileSync('bun', args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

function ensureZipAvailable() {
  const result = spawnSync('zip', ['-v'], { stdio: 'ignore' });

  if (result.status === 0) {
    return;
  }

  throw new Error(
    'The `zip` CLI is required to package plugin downloads. Install `zip` and rerun the build.',
  );
}

function runGenPluginMetadata() {
  const metadataScript = join(scriptDir, 'gen-plugin-metadata.mjs');
  execFileSync(process.execPath, [metadataScript], { stdio: 'inherit' });
}

ensureZipAvailable();

rmSync(downloadsDir, { recursive: true, force: true });
mkdirSync(downloadsDir, { recursive: true });

runBun(['run', '--cwd', 'packages/rs-module', 'build']);

runBun(['run', '--cwd', 'packages/extension', 'build']);
archiveDirectory(
  join(extensionDir, 'dist'),
  join(downloadsDir, artifactNames.chromium),
);

runBun(['run', '--cwd', 'packages/extension', 'build'], {
  BROWSER: 'firefox',
});
archiveDirectory(
  join(extensionDir, 'dist'),
  join(downloadsDir, artifactNames.firefox),
);

runBun(['run', '--cwd', 'packages/thunderbird', 'build']);
archiveDirectory(
  join(thunderbirdDir, 'dist'),
  join(downloadsDir, artifactNames.thunderbird),
);

runGenPluginMetadata();
