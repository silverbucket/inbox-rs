#!/usr/bin/env node
/**
 * Fail if the generated service worker's precache grows past budget.
 *
 * The precache is downloaded by every visitor on install and re-downloaded
 * (changed hashes) on every release, so regressions here are expensive and
 * silent — a single eager import of a heavy module can quietly re-inflate it.
 * Run after `vite build` in packages/web.
 *
 * Budget rationale: after excluding the lazy transformers/MarkdownEditor
 * chunks the precache sits around 0.9 MB; 1.2 MB leaves headroom for normal
 * growth while still catching a heavyweight regression.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUDGET_BYTES = 1.2 * 1024 * 1024;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const swPath = path.resolve(__dirname, '../packages/web/dist/sw.js');

let sw;
try {
  sw = readFileSync(swPath, 'utf8');
} catch {
  console.error(
    `[precache-budget] ${swPath} not found — run the web build first.`,
  );
  process.exit(1);
}

// Workbox emits the manifest as [{url:"...",revision:"..."}]. Sum the size of
// each referenced dist file.
const urls = [...sw.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]);
if (urls.length === 0) {
  console.error(
    '[precache-budget] no precache entries found in sw.js — did the Workbox output format change?',
  );
  process.exit(1);
}

const distDir = path.resolve(__dirname, '../packages/web/dist');
let total = 0;
const sized = [];
for (const url of urls) {
  const rel = url.replace(/^\//, '').split('?')[0];
  const file = path.join(
    distDir,
    rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel,
  );
  try {
    const bytes = readFileSync(file).length;
    total += bytes;
    sized.push([url, bytes]);
  } catch {
    // additionalManifestEntries like '/' may not map to a file cleanly; skip.
  }
}

const kib = (n) => `${(n / 1024).toFixed(0)} KiB`;
console.log(
  `[precache-budget] ${urls.length} entries, ${kib(total)} (budget ${kib(BUDGET_BYTES)})`,
);

if (total > BUDGET_BYTES) {
  console.error('\n[precache-budget] OVER BUDGET. Largest entries:');
  for (const [url, bytes] of sized.sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.error(`  ${kib(bytes).padStart(9)}  ${url}`);
  }
  console.error(
    '\nIf a lazy-loaded chunk landed in the precache, add it to workbox.globIgnores' +
      ' in packages/web/vite.config.ts (see the transformers/MarkdownEditor entries).',
  );
  process.exit(1);
}
