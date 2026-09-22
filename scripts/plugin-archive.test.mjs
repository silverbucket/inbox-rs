import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { archiveDirectory } from './plugin-archive.mjs';

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

it('excludes nested macOS metadata and replaces stale archive entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-archive-test-'));
  dirs.push(dir);
  const source = join(dir, 'source');
  mkdirSync(join(source, 'src'), { recursive: true });
  mkdirSync(join(source, '__MACOSX'));
  for (const path of [
    'src/background.ts',
    'src/._background.ts',
    '.DS_Store',
    '__MACOSX/junk',
    '.env',
    'stale.js',
  ])
    writeFileSync(join(source, path), 'fixture');
  const zip = join(dir, 'addon.xpi');
  archiveDirectory(source, zip);
  rmSync(join(source, 'stale.js'));
  archiveDirectory(source, zip);
  expect(
    execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' })
      .trim()
      .split('\n'),
  ).toEqual(['src/background.ts']);
});

it('rejects symlinks instead of including files outside the source tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-archive-test-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'source'));
  writeFileSync(join(dir, 'secret'), 'secret');
  symlinkSync(join(dir, 'secret'), join(dir, 'source/link'));
  expect(() =>
    archiveDirectory(join(dir, 'source'), join(dir, 'addon.xpi')),
  ).toThrow('symlink');
});
