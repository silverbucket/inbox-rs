/**
 * Helpers for checking the bun lockfile that ships in an extension's review
 * archive. Review archives must not mention the web, scripts, or e2e
 * workspaces at all, and must keep every retained dependency's exact
 * resolution.
 */

/**
 * Parse bun.lock. It is JSON plus trailing commas, so drop any comma that
 * (outside a string) is followed only by whitespace and a closing bracket.
 */
export function parseBunLock(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      out += char;
      if (char === '\\') out += text[++i];
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    if (char === ',' && /^\s*[}\]]/.test(text.slice(i + 1, i + 200))) continue;
    out += char;
  }
  return JSON.parse(out);
}

/**
 * Throw unless `scoped` lists exactly the root plus `workspaces`, and every
 * package it retains has the same entry (version, registry, dependencies,
 * integrity) as in `original`.
 */
export function assertScopedLockfile(original, scoped, workspaces) {
  const found = Object.keys(scoped.workspaces).sort();
  const expected = ['', ...workspaces].sort();
  if (found.join() !== expected.join())
    throw new Error(`Unexpected workspaces in scoped lockfile: ${found}`);
  for (const [key, entry] of Object.entries(scoped.packages)) {
    if (JSON.stringify(entry) !== JSON.stringify(original.packages[key]))
      throw new Error(`Dependency resolution changed while scoping: ${key}`);
  }
}
