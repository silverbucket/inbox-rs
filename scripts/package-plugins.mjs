import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const packageJsonPath = join(rootDir, 'package.json');
const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

const extensionDir = join(rootDir, 'packages', 'extension');
const thunderbirdDir = join(rootDir, 'packages', 'thunderbird');
const downloadsDir = join(rootDir, 'packages', 'web', 'public', 'downloads');
const generatedMetadataPath = join(rootDir, 'packages', 'web', 'src', 'lib', 'plugin-downloads.generated.ts');

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

function writeGeneratedMetadata() {
  const fileContents = `export const pluginArtifactVersion = ${JSON.stringify(version)} as const;

export const pluginArtifacts = {
  chromium: ${JSON.stringify(`/downloads/${artifactNames.chromium}`)},
  firefox: ${JSON.stringify(`/downloads/${artifactNames.firefox}`)},
  thunderbird: ${JSON.stringify(`/downloads/${artifactNames.thunderbird}`)},
} as const;
`;

  writeFileSync(generatedMetadataPath, fileContents);
}

rmSync(downloadsDir, { recursive: true, force: true });
mkdirSync(downloadsDir, { recursive: true });

runNpm(['run', 'build', '--workspace=packages/rs-module']);

runNpm(['run', 'build', '--workspace=packages/extension']);
archiveDirectory(join(extensionDir, 'dist'), join(downloadsDir, artifactNames.chromium));

runNpm(['run', 'build', '--workspace=packages/extension'], { BROWSER: 'firefox' });
archiveDirectory(join(extensionDir, 'dist'), join(downloadsDir, artifactNames.firefox));

runNpm(['run', 'build', '--workspace=packages/thunderbird']);
archiveDirectory(join(thunderbirdDir, 'dist'), join(downloadsDir, artifactNames.thunderbird));

writeGeneratedMetadata();
