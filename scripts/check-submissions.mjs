import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveFiles } from './plugin-archive.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = process.argv.slice(2);
if (!targets.length) targets.push('chromium', 'firefox', 'thunderbird');
function npm(args, cwd) {
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd,
    stdio: 'inherit',
  });
}
for (const target of targets) {
  const output = join(root, 'dist/submissions', target);
  const names = readdirSync(output);
  const sourceName = names.find((name) => name.endsWith('-source.zip'));
  const binaryName = names.find(
    (name) => /\.(zip|xpi)$/.test(name) && name !== sourceName,
  );
  assert(sourceName && binaryName, `Missing ${target} submission pair`);
  const temporary = mkdtempSync(join(tmpdir(), 'inbox-rs-rebuild-'));
  try {
    for (const [name, destination] of [
      [sourceName, 'source'],
      [binaryName, 'original'],
    ]) {
      const entries = execFileSync('unzip', ['-Z1', join(output, name)], {
        encoding: 'utf8',
      })
        .trim()
        .split('\n');
      assert(
        entries.every(
          (entry) =>
            !entry.startsWith('/') &&
            entry
              .split('/')
              .every((part) => !part.startsWith('.') && part !== '__MACOSX'),
        ),
        `Unsafe/hidden path in ${name}`,
      );
      execFileSync('unzip', [
        '-q',
        join(output, name),
        '-d',
        join(temporary, destination),
      ]);
    }
    const source = join(temporary, 'source');
    const sourceManifest = JSON.parse(
      readFileSync(join(source, 'package.json')),
    );
    assert.equal(sourceManifest.workspaces.length, 2);
    const lock = JSON.parse(readFileSync(join(source, 'package-lock.json')));
    assert(
      !Object.keys(lock.packages).some(
        (path) =>
          path.startsWith('packages/web') ||
          path.startsWith('tests/') ||
          path === 'scripts',
      ),
    );
    npm(['ci', '--no-fund'], source);
    if (process.platform === 'linux') {
      npm(['install', '@rollup/rollup-linux-x64-gnu', '--no-save'], source);
    }
    npm(['audit', '--audit-level=high'], source);
    npm(['run', 'package:submission'], source);
    execFileSync('unzip', [
      '-q',
      join(source, 'dist/submissions', target, binaryName),
      '-d',
      join(temporary, 'rebuilt'),
    ]);
    const original = join(temporary, 'original');
    const rebuilt = join(temporary, 'rebuilt');
    const files = archiveFiles(original);
    assert.deepEqual(
      archiveFiles(rebuilt),
      files,
      `${target}: different file list`,
    );
    for (const file of files)
      assert(
        readFileSync(join(original, file)).equals(
          readFileSync(join(rebuilt, file)),
        ),
        `${target}: different bytes in ${file}`,
      );
    const downloads = join(root, 'packages/web/public/downloads', binaryName);
    if (existsSync(downloads)) {
      const releaseFiles = execFileSync('unzip', ['-Z1', downloads], {
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .sort();
      assert.deepEqual(
        releaseFiles,
        [...files].sort(),
        `${target}: release download has different files`,
      );
      for (const file of files)
        assert(
          execFileSync('unzip', ['-p', downloads, file]).equals(
            readFileSync(join(original, file)),
          ),
          `${target}: release download differs in ${file}`,
        );
    }
    console.log(`${target}: ${files.length} files reproduced byte for byte`);
    if (target === 'firefox') {
      const report = JSON.parse(
        execFileSync(
          process.execPath,
          [
            process.env.npm_execpath,
            'exec',
            '--no',
            '--',
            'web-ext',
            'lint',
            '--source-dir',
            original,
            '--output',
            'json',
          ],
          { cwd: root, encoding: 'utf8' },
        ),
      );
      assert.equal(report.errors.length, 0, 'Firefox lint errors');
      for (const warning of report.warnings) {
        // Older supported Firefox versions ignore this forward-compatible key.
        const futurePrivacyKey =
          [
            'KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION',
            'KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION',
          ].includes(warning.code) &&
          warning.file === 'manifest.json' &&
          warning.description.includes('data_collection_permissions');
        // Svelte creates compiled static templates through this helper. User
        // content is bound as text; no {@html} is used in these components.
        let staticTemplate = false;
        if (
          warning.code === 'UNSAFE_VAR_ASSIGNMENT' &&
          /^chunks\/disclose-version-[\w-]+\.js$/.test(warning.file)
        ) {
          const line = readFileSync(join(original, warning.file), 'utf8').split(
            '\n',
          )[warning.line - 1];
          const fragment = line.slice(warning.column - 1, warning.column + 100);
          staticTemplate =
            /^\w+\.innerHTML=\w+\(\w+\.replaceAll\("<!>","<!---->"\)\)/.test(
              fragment,
            );
        }
        assert(
          futurePrivacyKey || staticTemplate,
          `Unreviewed Firefox warning: ${JSON.stringify(warning)}`,
        );
        console.log(
          `Reviewed Firefox warning: ${warning.code} (${warning.file})`,
        );
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
