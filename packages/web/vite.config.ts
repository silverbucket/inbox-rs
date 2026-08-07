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
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      includeAssets: [
        'manifest.webmanifest',
        'favicon-16.png',
        'favicon-32.png',
        'apple-touch-icon.png',
        'icon-192.png',
        'icon-512.png',
        'icon-192-maskable.png',
        'icon-512-maskable.png',
      ],
      workbox: {
        additionalManifestEntries: [
          { url: '/', revision: version },
          { url: '/capture/', revision: version },
        ],
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        // The quick-capture app is its own shell (capture/index.html). Without
        // this, any /capture/ navigation that isn't an exact precache match
        // (query params from OAuth redirects or a future share_target, sub-
        // paths) falls through to the MAIN app's index.html and boots the
        // wrong app inside the capture PWA window.
        navigateFallbackDenylist: [/^\/capture\//],
        globPatterns: ['**/*.{js,css,html,json,png,svg,webmanifest,wasm}'],
        globIgnores: [
          'ml/**/*',
          // Lazy-only heavyweights (~1.4 MB minified combined). They're
          // dynamic-imported and most sessions never execute them, yet
          // precaching forces every visitor to download them on install and
          // re-download on every release (content hashes change). Excluding
          // them cuts the precache from ~2.2 MB to ~0.85 MB; the runtime
          // CacheFirst route below still makes them offline-available after
          // first use (hashed filenames are immutable, so CacheFirst is safe).
          'assets/transformers-*.js',
          'assets/MarkdownEditor-*.js',
          'assets/MarkdownEditor-*.css',
        ],
        runtimeCaching: [
          {
            urlPattern:
              /\/assets\/(transformers|MarkdownEditor)-[^/]*\.(js|css)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lazy-chunks',
              expiration: {
                maxEntries: 12,
                maxAgeSeconds: 60 * 60 * 24 * 60, // 60 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
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
    manifest: 'asset-manifest.json',
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
        mainShell: path.resolve(__dirname, 'index.html'),
        captureShell: path.resolve(__dirname, 'capture/index.html'),
        main: path.resolve(__dirname, 'src/main.ts'),
        capture: path.resolve(__dirname, 'src/capture/main.ts'),
      },
    },
  },
});
