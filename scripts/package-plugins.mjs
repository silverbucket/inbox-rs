import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const packageJsonPath = join(rootDir, 'package.json');
const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

const extensionDir = join(rootDir, 'packages', 'extension');
const thunderbirdDir = join(rootDir, 'packages', 'thunderbird');
const downloadsDir = join(rootDir, 'packages', 'web', 'public', 'downloads');

const artifactNames = {
  chromium: `inbox-rs-chromium-${version}.zip`,
  firefox: `inbox-rs-firefox-${version}.xpi`,
  thunderbird: `inbox-rs-thunderbird-${version}.xpi`,
};

function runNpm(args, env = {}) {
  const npmExecPath = process.env.npm_execpath;

  if (!npmExecPath) {
    throw new Error('npm_execpath is not available; run this script via npm.');
  }

  execFileSync(process.execPath, [npmExecPath, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

function archiveDirectory(sourceDir, targetFile) {
  rmSync(targetFile, { force: true });
  execFileSync('zip', ['-qr', targetFile, '.'], {
    cwd: sourceDir,
    stdio: 'inherit',
  });
}

function ensureZipAvailable() {
  const result = spawnSync('zip', ['-v'], { stdio: 'ignore' });

  if (result.status === 0) {
    return;
  }

  throw new Error(
    'The `zip` CLI is required to package plugin downloads. Install `zip` and rerun the build.'
  );
}

function runGenPluginMetadata() {
  const metadataScript = join(scriptDir, 'gen-plugin-metadata.mjs');
  execFileSync(process.execPath, [metadataScript], { stdio: 'inherit' });
}

ensureZipAvailable();

rmSync(downloadsDir, { recursive: true, force: true });
mkdirSync(downloadsDir, { recursive: true });

runNpm(['run', 'build', '--workspace=packages/rs-module']);

runNpm(['run', 'build', '--workspace=packages/extension']);
archiveDirectory(join(extensionDir, 'dist'), join(downloadsDir, artifactNames.chromium));

runNpm(['run', 'build', '--workspace=packages/extension'], { BROWSER: 'firefox' });
archiveDirectory(join(extensionDir, 'dist'), join(downloadsDir, artifactNames.firefox));

runNpm(['run', 'build', '--workspace=packages/thunderbird']);
archiveDirectory(join(thunderbirdDir, 'dist'), join(downloadsDir, artifactNames.thunderbird));

runGenPluginMetadata();
