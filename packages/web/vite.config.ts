import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'),
);

// Staging builds (STAGING_BUILD=1, set by the staging deploy paths) emit
// sourcemaps and flip __STAGING__ so the app can surface extra debugging
// help. Production builds leave both off — nothing here changes for them.
const isStaging = process.env.STAGING_BUILD === '1';

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: false,
      includeAssets: [
        'manifest.webmanifest',
        'favicon-16.png',
        'favicon-32.png',
        'apple-touch-icon.png',
        'icon-192.png',
        'icon-512.png',
      ],
      workbox: {
        additionalManifestEntries: [
          { url: '/', revision: version },
          { url: '/capture/', revision: version },
        ],
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,wasm}'],
        globIgnores: ['ml/**/*'],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __STAGING__: JSON.stringify(isStaging),
  },
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      'onnxruntime-node': 'onnxruntime-web',
      sharp: 'onnxruntime-web',
    },
    // Under Vitest, resolve Svelte (and deps) to their browser builds so
    // components can be mounted with the client runtime (mount/flushSync).
    // Without this they compile for SSR and `lifecycle_function_unavailable`
    // is thrown. Scoped to test runs so dev/build resolution is unchanged.
    ...(process.env.VITEST ? { conditions: ['browser'] } : {}),
  },
  build: {
    // Bump above Vite's default `modules` baseline so top-level `await` is
    // available. Used in `src/lib/rs.ts` to gate RS construction on a
    // corrupt-IndexedDB self-recovery probe. TLA shipped in Chrome 89 / Edge
    // 89 / Firefox 89 / Safari 15 — all 2021 baselines, well below our
    // supported floor.
    target: ['chrome89', 'edge89', 'firefox89', 'safari15'],
    // Emit full external sourcemaps for staging so runtime errors map back to
    // original TypeScript/Svelte. Off for production to keep source private.
    sourcemap: isStaging,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        capture: path.resolve(__dirname, 'capture/index.html'),
      },
    },
  },
});
