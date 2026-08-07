#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(
  process.argv[2] ?? join(__dirname, '../packages/web/dist'),
);
const errors = [];

function requireFile(path, source) {
  if (!existsSync(join(dist, path)))
    errors.push(`${source} references missing ${path}`);
}

for (const htmlPath of ['index.html', 'capture/index.html']) {
  const html = readFileSync(join(dist, htmlPath), 'utf8');
  if (!html.includes('<script src="/app-loader.js"></script>')) {
    errors.push(
      `${htmlPath} does not use the stable /app-loader.js entrypoint`,
    );
  }
  if (/script[^>]+src="\/assets\//.test(html)) {
    errors.push(`${htmlPath} directly references a versioned script`);
  }
}

requireFile('app-loader.js', 'HTML shell');
requireFile('sw.js', 'PWA registration');

const manifestPath = join(dist, 'asset-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
for (const entryKey of ['src/main.ts', 'src/capture/main.ts']) {
  const entry = manifest[entryKey];
  if (!entry?.isEntry || typeof entry.file !== 'string') {
    errors.push(`asset-manifest.json has no build entry for ${entryKey}`);
    continue;
  }
  requireFile(entry.file, entryKey);
  for (const file of [...(entry.css ?? []), ...(entry.assets ?? [])]) {
    requireFile(file, entryKey);
  }
}

if (errors.length > 0) {
  console.error(`Invalid web deployment:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

console.log(
  'Web deployment entrypoints and manifests are internally consistent.',
);
