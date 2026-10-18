/**
 * npm's `--package-lock-only` scoping leaves unreachable workspaces marked
 * `extraneous: true` instead of deleting them. Review archives must not
 * mention web, scripts, or e2e workspaces at all.
 */
export function pruneScopedLockfile(lock, workspaces) {
  const keep = new Set(['', ...workspaces]);
  for (const [path, entry] of Object.entries({ ...lock.packages })) {
    if (entry.extraneous) {
      delete lock.packages[path];
      continue;
    }
    if (
      path &&
      !path.includes('node_modules/') &&
      !keep.has(path) &&
      !workspaces.some((workspace) => path.startsWith(`${workspace}/`))
    ) {
      delete lock.packages[path];
    }
  }
  for (const [path, entry] of Object.entries({ ...lock.packages })) {
    if (!path.includes('node_modules/')) continue;
    const { resolved } = entry;
    if (
      resolved &&
      !workspaces.includes(resolved) &&
      (resolved.startsWith('packages/') ||
        resolved.startsWith('tests/') ||
        resolved === 'scripts')
    ) {
      delete lock.packages[path];
    }
  }
  return lock;
}
