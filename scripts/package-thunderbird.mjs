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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'packages/thunderbird/dist/submission');
const version = JSON.parse(
  readFileSync(join(root, 'packages/thunderbird/package.json')),
).version;
const npm = (args) =>
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd: root,
    stdio: 'inherit',
  });
npm(['run', 'build', '--workspace=packages/rs-module']);
npm(['run', 'build', '--workspace=packages/thunderbird']);
// Stage outside dist so an archive can never include itself.
const stage = mkdtempSync(join(tmpdir(), 'inbox-rs-submission-'));
try {
  const source = join(stage, 'source');
  mkdirSync(source);
  const inputs = [
    'package.json',
    'package-lock.json',
    'scripts/package.json',
    'tests/e2e/package.json',
    'packages/web/package.json',
    'packages/extension/package.json',
    'packages/thunderbird',
    'packages/rs-module',
    'scripts/plugin-archive.mjs',
    'scripts/package-thunderbird.mjs',
  ];
  for (const input of inputs) {
    const files =
      input === 'packages/thunderbird' || input === 'packages/rs-module'
        ? archiveFiles(join(root, input))
            .filter(
              (file) =>
                !file.includes('.test.') &&
                !file.startsWith('vitest.') &&
                !file.endsWith('.xpi') &&
                !file.endsWith('.tar.gz'),
            )
            .map((file) => join(input, file))
        : [input];
    for (const file of files) {
      mkdirSync(dirname(join(source, file)), { recursive: true });
      cpSync(join(root, file), join(source, file));
    }
  }
  cpSync(
    join(root, 'packages/thunderbird/BUILDING.md'),
    join(source, 'README.md'),
  );
  writeFileSync(
    join(source, 'BUILD-ENVIRONMENT.txt'),
    `Node ${process.version}\nnpm ${process.env.npm_config_user_agent}\nPlatform ${process.platform} ${process.arch}\nThunderbird add-on ${version}\n`,
  );
  const xpi = `inbox-rs-thunderbird-${version}.xpi`;
  archiveDirectory(join(root, 'packages/thunderbird/dist'), join(stage, xpi));
  archiveDirectory(
    source,
    join(stage, `inbox-rs-thunderbird-${version}-source.zip`),
  );
  mkdirSync(output, { recursive: true });
  for (const file of [xpi, `inbox-rs-thunderbird-${version}-source.zip`])
    cpSync(join(stage, file), join(output, file));
  console.log(`Submission files: ${output}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
