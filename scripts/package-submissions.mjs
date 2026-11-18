import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveDirectory, archiveFiles } from './plugin-archive.mjs';
import { assertScopedLockfile, parseBunLock } from './submission-lockfile.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = process.argv.slice(2);
if (!targets.length) targets.push('chromium', 'firefox', 'thunderbird');
if (
  targets.some(
    (target) => !['chromium', 'firefox', 'thunderbird'].includes(target),
  )
)
  throw new Error('Expected chromium, firefox or thunderbird');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
function bun(args, cwd = root, env = {}) {
  execFileSync('bun', args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
}

for (const target of targets) {
  const workspace = target === 'thunderbird' ? 'thunderbird' : 'extension';
  const packagePath = `packages/${workspace}`;
  const version = json(join(root, packagePath, 'package.json')).version;
  const manifestName =
    target === 'firefox' ? 'manifest.firefox.json' : 'manifest.json';
  if (json(join(root, packagePath, manifestName)).version !== version)
    throw new Error(`${target} manifest/package version mismatch`);
  bun(['run', '--cwd', 'packages/rs-module', 'build']);
  bun(['run', '--cwd', packagePath, 'build'], root, {
    BROWSER: target === 'firefox' ? 'firefox' : 'chrome',
  });
  const output = join(root, 'dist/submissions', target);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const stem = `inbox-rs-${target}-${version}`;
  archiveDirectory(
    join(root, packagePath, 'dist'),
    join(output, `${stem}.${target === 'chromium' ? 'zip' : 'xpi'}`),
  );

  const source = mkdtempSync(join(tmpdir(), 'inbox-rs-source-'));
  try {
    for (const pkg of [packagePath, 'packages/rs-module']) {
      // Only build inputs, never arbitrary files in a developer's package folder.
      for (const file of archiveFiles(join(root, pkg)).filter(
        (file) =>
          (file.startsWith('src/') && !file.includes('.test.')) ||
          file.startsWith('icons/') ||
          [
            'package.json',
            'tsconfig.json',
            'vite.config.ts',
            'svelte.config.js',
            'manifest.json',
            'manifest.firefox.json',
          ].includes(file),
      )) {
        const destination = join(source, pkg, file);
        mkdirSync(dirname(destination), { recursive: true });
        cpSync(join(root, pkg, file), destination);
      }
    }
    cpSync(join(root, 'LICENSE'), join(source, 'LICENSE'));
    mkdirSync(join(source, 'scripts'));
    for (const script of [
      'package-submissions.mjs',
      'plugin-archive.mjs',
      'submission-lockfile.mjs',
    ])
      cpSync(join(root, 'scripts', script), join(source, 'scripts', script));
    const { packageManager, overrides } = json(join(root, 'package.json'));
    const workspaces = [packagePath, 'packages/rs-module'];
    writeJson(join(source, 'package.json'), {
      name: `inbox-rs-${target}-review`,
      version,
      private: true,
      license: 'GPL-3.0-or-later',
      packageManager,
      workspaces,
      scripts: {
        'package:submission': `node scripts/package-submissions.mjs ${target}`,
      },
      overrides,
    });
    const originalLock = readFileSync(join(root, 'bun.lock'), 'utf8');
    writeFileSync(join(source, 'bun.lock'), originalLock);
    // bun drops the workspaces and packages the scoped source can't reach but
    // keeps every selected dependency's exact resolution. No registry refresh
    // is permitted.
    bun(
      ['install', '--lockfile-only', '--offline', '--ignore-scripts'],
      source,
    );
    assertScopedLockfile(
      parseBunLock(originalLock),
      parseBunLock(readFileSync(join(source, 'bun.lock'), 'utf8')),
      workspaces,
    );
    const readme = `# Reproduce Inbox RS for ${target}\n\nInstall Node.js 24 from https://nodejs.org/en/download, Bun ${packageManager.replace(/^bun@/, '')} (https://bun.sh/docs/installation) and Info-ZIP zip/unzip (Ubuntu: sudo apt install zip unzip; included on macOS). Exact producer versions are in BUILD-ENVIRONMENT.txt. Internet access to the npm registry is needed for bun install. No Git checkout, browser, account or server is needed.\n\nFrom this extracted archive's root:\n\n\`\`\`sh\nbun install --frozen-lockfile\nbun run package:submission\n\`\`\`\n\nThe matching installable artifact and source ZIP are written to dist/submissions/${target}/. The unpacked build is in ${packagePath}/dist/. The rebuilt installable XPI/ZIP matches the original whole archive byte for byte with the same build tools. Staged file modes are normalized to 0644 and timestamps to SOURCE_DATE_EPOCH (default 315532964, 1980-01-01T00:02:44Z); ZIP uses UTC. Build outputs are never modified. Use the same SOURCE_DATE_EPOCH for both builds.\n\nThis archive contains only the ${workspace} and rs-module workspaces. Its bun.lock is a pruned copy of the repository lockfile: every retained dependency has the same version, resolution and integrity. Packaging fails if scoping changes any of those. The source includes the same Vite/Svelte/TypeScript build configuration used for the release. Do not update dependencies when reproducing a submission.\n`;
    writeFileSync(join(source, 'README.md'), readme);
    writeFileSync(
      join(source, 'BUILD-ENVIRONMENT.txt'),
      `Node ${process.version}\nBun ${execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim()}\nPlatform ${process.platform} ${process.arch}\nTarget ${target} ${version}\n`,
    );
    archiveDirectory(source, join(output, `${stem}-source.zip`));
    console.log(`Submission: ${output}`);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
}
