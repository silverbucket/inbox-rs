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
import { pruneScopedLockfile } from './submission-lockfile.mjs';

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
function npm(args, cwd = root, env = {}) {
  if (!process.env.npm_execpath) throw new Error('Run via npm');
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
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
  npm(['run', 'build', '--workspace=packages/rs-module']);
  npm(['run', 'build', `--workspace=${packagePath}`], root, {
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
    writeJson(join(source, 'package.json'), {
      name: `inbox-rs-${target}-review`,
      version,
      private: true,
      license: 'GPL-3.0-or-later',
      workspaces: [packagePath, 'packages/rs-module'],
      scripts: {
        'package:submission': `node scripts/package-submissions.mjs ${target}`,
      },
    });
    const originalLock = json(join(root, 'package-lock.json'));
    cpSync(join(root, 'package-lock.json'), join(source, 'package-lock.json'));
    // npm removes unreachable workspaces/dependencies but must retain every
    // selected dependency's exact resolution. No registry refresh is permitted.
    npm(
      [
        'install',
        '--package-lock-only',
        '--ignore-scripts',
        '--offline',
        '--no-audit',
        '--no-fund',
      ],
      source,
    );
    const scopedLock = pruneScopedLockfile(
      json(join(source, 'package-lock.json')),
      [packagePath, 'packages/rs-module'],
    );
    writeJson(join(source, 'package-lock.json'), scopedLock);
    for (const [path, entry] of Object.entries(scopedLock.packages)) {
      if (!path.includes('node_modules/')) continue;
      const original = originalLock.packages[path];
      for (const key of ['version', 'resolved', 'integrity']) {
        if (entry[key] !== original?.[key])
          throw new Error(
            `Dependency resolution changed while scoping: ${path} (${key})`,
          );
      }
    }
    const readme = `# Reproduce Inbox RS for ${target}\n\nInstall Node.js 24 and npm 11 from https://nodejs.org/en/download and Info-ZIP zip/unzip (Ubuntu: sudo apt install zip unzip; included on macOS). Exact producer versions are in BUILD-ENVIRONMENT.txt. Internet access to the npm registry is needed for npm ci. No Git checkout, browser, account or server is needed.\n\nFrom this extracted archive's root:\n\n\`\`\`sh\nnpm ci\n# Linux only: npm sometimes skips Rollup's native optional dependency.\n# Run this once if \`npm run package:submission\` fails with a missing\n# @rollup/rollup-linux-x64-gnu module.\n# npm install @rollup/rollup-linux-x64-gnu --no-save\nnpm run package:submission\n\`\`\`\n\nThe matching installable artifact and source ZIP are written to dist/submissions/${target}/. The unpacked build is in ${packagePath}/dist/. Compare unpacked XPI/ZIP file contents, not archive timestamps.\n\nThis archive contains only the ${workspace} and rs-module workspaces. Its lockfile is a pruned copy of the repository lockfile: every retained dependency has the same version, resolution and integrity. Packaging fails if scoping changes any of those. The source includes the same Vite/Svelte/TypeScript build configuration used for the release. Do not update dependencies when reproducing a submission.\n`;
    writeFileSync(join(source, 'README.md'), readme);
    writeFileSync(
      join(source, 'BUILD-ENVIRONMENT.txt'),
      `Node ${process.version}\nnpm ${process.env.npm_config_user_agent}\nPlatform ${process.platform} ${process.arch}\nTarget ${target} ${version}\n`,
    );
    archiveDirectory(source, join(output, `${stem}-source.zip`));
    console.log(`Submission: ${output}`);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
}
