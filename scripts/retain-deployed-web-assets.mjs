#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const [deployedRef, distArg = 'packages/web/dist'] = process.argv.slice(2);
if (!deployedRef) {
  console.error(
    'Usage: retain-deployed-web-assets.mjs <deployed-ref> [dist-directory]',
  );
  process.exit(1);
}

const dist = resolve(distArg);

function listFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(absolute));
    else files.push(relative(dist, absolute).split(sep).join('/'));
  }
  return files;
}

function gitOutput(args, encoding = 'utf8') {
  return execFileSync('git', args, {
    encoding,
    maxBuffer: 100 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const currentAssets = new Set(listFiles(join(dist, 'assets')));
const deployedAssets = gitOutput([
  'ls-tree',
  '-r',
  '--name-only',
  deployedRef,
  '--',
  'assets',
])
  .trim()
  .split('\n')
  .filter((asset) => asset && !asset.endsWith('.map'));

if (deployedAssets.some((asset) => !asset.startsWith('assets/'))) {
  throw new Error(`Invalid deployed asset path at ${deployedRef}`);
}

let retained = 0;
for (const asset of deployedAssets) {
  if (currentAssets.has(asset)) continue;
  const destination = join(dist, asset);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(
    destination,
    gitOutput(['show', `${deployedRef}:${asset}`], null),
  );
  retained += 1;
}

console.log(
  `Retained ${retained} immutable runtime assets from ${deployedRef}.`,
);
