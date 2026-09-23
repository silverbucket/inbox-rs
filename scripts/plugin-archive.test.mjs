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
import { archiveDirectory, archiveFiles } from './plugin-archive.mjs';

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

it('excludes dotfiles, node_modules, and dist directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-archive-test-'));
  dirs.push(dir);
  const source = join(dir, 'source');
  mkdirSync(join(source, 'keep'), { recursive: true });
  mkdirSync(join(source, 'node_modules/pkg'), { recursive: true });
  mkdirSync(join(source, 'dist'), { recursive: true });
  for (const path of [
    'keep/ok.js',
    '.env',
    'node_modules/pkg/index.js',
    'dist/bundle.js',
  ])
    writeFileSync(join(source, path), 'fixture');
  expect(archiveFiles(source)).toEqual(['keep/ok.js']);
});

it('returns a sorted file list for reproducible archives', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-archive-test-'));
  dirs.push(dir);
  const source = join(dir, 'source');
  mkdirSync(source, { recursive: true });
  for (const name of ['z.js', 'a.js', 'm.js'])
    writeFileSync(join(source, name), 'fixture');
  expect(archiveFiles(source)).toEqual(['a.js', 'm.js', 'z.js']);
});

it('rejects empty source directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-archive-test-'));
  dirs.push(dir);
  const source = join(dir, 'source');
  mkdirSync(source);
  expect(() => archiveDirectory(source, join(dir, 'addon.xpi'))).toThrow(
    'Empty archive',
  );
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
