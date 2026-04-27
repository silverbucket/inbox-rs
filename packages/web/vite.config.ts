import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5173
  },
  resolve: {
    alias: {
      'onnxruntime-node': 'onnxruntime-web',
      'sharp': 'onnxruntime-web',
    }
  },
  build: {
    // Bump above Vite's default `modules` baseline so top-level `await` is
    // available. Used in `src/lib/rs.ts` to gate RS construction on a
    // corrupt-IndexedDB self-recovery probe. TLA shipped in Chrome 89 / Edge
    // 89 / Firefox 89 / Safari 15 — all 2021 baselines, well below our
    // supported floor.
    target: ['chrome89', 'edge89', 'firefox89', 'safari15'],
  },
});
