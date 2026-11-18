import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertScopedLockfile, parseBunLock } from './submission-lockfile.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = parseBunLock(readFileSync(join(root, 'bun.lock'), 'utf8'));

describe('parseBunLock', () => {
  it('reads the repository lockfile', () => {
    expect(Object.keys(lock.workspaces).sort()).toEqual([
      '',
      'packages/extension',
      'packages/rs-module',
      'packages/thunderbird',
      'packages/web',
      'scripts',
      'tests/e2e',
    ]);
    expect(lock.packages.svelte[0]).toMatch(/^svelte@/);
  });

  it('drops trailing commas but keeps commas inside strings', () => {
    expect(parseBunLock('{ "a": [",]", "b,}",], }')).toEqual({
      a: [',]', 'b,}'],
    });
  });
});

describe('assertScopedLockfile', () => {
  const workspaces = ['packages/extension', 'packages/rs-module'];
  const scoped = () => ({
    workspaces: Object.fromEntries(
      ['', ...workspaces].map((path) => [path, lock.workspaces[path]]),
    ),
    packages: { svelte: lock.packages.svelte },
  });

  it('accepts a pruned copy', () => {
    expect(() =>
      assertScopedLockfile(lock, scoped(), workspaces),
    ).not.toThrow();
  });

  it('rejects leftover monorepo workspaces', () => {
    const extra = scoped();
    extra.workspaces['packages/web'] = lock.workspaces['packages/web'];
    expect(() => assertScopedLockfile(lock, extra, workspaces)).toThrow(
      /Unexpected workspaces/,
    );
  });

  it('rejects a changed resolution', () => {
    const changed = scoped();
    changed.packages.svelte = [...lock.packages.svelte];
    changed.packages.svelte[3] = 'sha512-changed';
    expect(() => assertScopedLockfile(lock, changed, workspaces)).toThrow(
      /resolution changed while scoping: svelte/,
    );
  });
});
