import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { pruneScopedLockfile } from './submission-lockfile.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const originalLock = JSON.parse(
  readFileSync(join(root, 'package-lock.json'), 'utf8'),
);

it('removes extraneous monorepo workspaces from a scoped lockfile', () => {
  const lock = structuredClone(originalLock);
  lock.packages[''] = {
    ...lock.packages[''],
    name: 'inbox-rs-chromium-review',
    workspaces: ['packages/extension', 'packages/rs-module'],
  };
  for (const path of [
    'packages/thunderbird',
    'packages/web',
    'scripts',
    'tests/e2e',
  ]) {
    lock.packages[path] = { ...lock.packages[path], extraneous: true };
  }

  pruneScopedLockfile(lock, ['packages/extension', 'packages/rs-module']);

  const paths = Object.keys(lock.packages);
  expect(paths).not.toContain('packages/web');
  expect(paths).not.toContain('packages/thunderbird');
  expect(paths).not.toContain('scripts');
  expect(paths).not.toContain('tests/e2e');
  expect(paths).not.toContain('node_modules/@inbox-rs/web');
  expect(paths).not.toContain('node_modules/@inbox-rs/scripts');
  expect(paths).not.toContain('node_modules/@inbox-rs/e2e');
  expect(paths.some((path) => path.startsWith('packages/extension'))).toBe(
    true,
  );
  expect(paths).toContain('packages/rs-module');
});
