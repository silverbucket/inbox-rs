/// <reference lib="webworker" />
// Service worker source (vite-plugin-pwa injectManifest). Mirrors exactly what
// the former generateSW config emitted, plus the POST share-target handler.
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { SHARE_CACHE, stashShare } from './lib/share-target';

declare let self: ServiceWorkerGlobalScope;

// Web Share Target: the OS share sheet POSTs multipart form data here.
// Registered before workbox's listeners so it gets first look at the request.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/capture/') return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const target = await stashShare(form, await caches.open(SHARE_CACHE));
      return Response.redirect(new URL(target, self.location.href).href, 303);
    })(),
  );
});

// registerType: 'prompt' — app-loader.js posts SKIP_WAITING to a waiting worker.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

clientsClaim();

precacheAndRoute(self.__WB_MANIFEST, {
  // Share-target and OAuth navigations hit /capture/?… — strip query
  // params so they match the precached capture shell instead of missing
  // the exact /capture/ key and falling through to the network.
  ignoreURLParametersMatching: [/.*/],
});

cleanupOutdatedCaches();

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    // The quick-capture app is its own shell (capture/index.html). Without
    // this, any /capture/ navigation that isn't an exact precache match
    // (sub-paths) falls through to the MAIN app's index.html and boots the
    // wrong app inside the capture PWA window.
    denylist: [/^\/capture\//, /^\/privacy\//],
  }),
);

// Lazy-only heavyweights excluded from the precache (see vite.config.ts);
// CacheFirst still makes them offline-available after first use (hashed
// filenames are immutable, so CacheFirst is safe).
registerRoute(
  /\/assets\/(transformers|MarkdownEditor)-[^/]*\.(js|css)$/,
  new CacheFirst({
    cacheName: 'lazy-chunks',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 12,
        maxAgeSeconds: 60 * 60 * 24 * 60, // 60 days
      }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
  'GET',
);
