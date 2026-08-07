#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const [deployedRef, distArg = 'packages/web/dist'] = process.argv.slice(2);
if (!deployedRef) {
  console.error(
    'Usage: create-deployed-entry-shims.mjs <deployed-ref> [dist-directory]',
  );
  process.exit(1);
}

const dist = resolve(distArg);
const knownEntries = JSON.parse(
  readFileSync(new URL('./deployed-entrypoints.json', import.meta.url), 'utf8'),
);
const manifest = JSON.parse(
  readFileSync(join(dist, 'asset-manifest.json'), 'utf8'),
);
const currentEntries = new Set(
  ['src/main.ts', 'src/capture/main.ts']
    .map((key) => manifest[key]?.file)
    .filter((file) => typeof file === 'string'),
);

if (
  !Array.isArray(knownEntries) ||
  knownEntries.some(
    (entry) =>
      typeof entry !== 'string' || !/^assets\/[A-Za-z0-9_.-]+\.js$/.test(entry),
  )
) {
  throw new Error('deployed-entrypoints.json contains an invalid asset path');
}

function gitOutput(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const commits = gitOutput(['rev-list', deployedRef]).trim().split('\n');
const entryScripts = new Set(knownEntries);
const scriptPattern =
  /<script\b[^>]*\bsrc=["']\/(assets\/[^"']+\.js)["'][^>]*>/g;

for (const commit of commits) {
  for (const htmlPath of ['index.html', 'capture/index.html']) {
    let html;
    try {
      html = gitOutput(['show', `${commit}:${htmlPath}`]);
    } catch {
      continue;
    }
    for (const match of html.matchAll(scriptPattern)) {
      entryScripts.add(match[1]);
    }
  }
}

let created = 0;
for (const entryScript of entryScripts) {
  if (currentEntries.has(entryScript)) continue;
  const destination = join(dist, entryScript);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(
    destination,
    "/* Historical entry recovery shim. */\nimport '/app-loader.js';\n",
  );
  created += 1;
}

console.log(`Created ${created} historical entry shims from ${deployedRef}.`);
