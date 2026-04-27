/**
 * PWA installability checks: manifest, theme color, icons, viewport.
 *
 * These tests run with no remoteStorage session — the empty-state landing
 * page exposes every PWA-shell concern we care about.
 */

import { test, expect } from '../helpers/fixtures';

test.describe('PWA manifest & install requirements', () => {
  test('manifest is served and valid', async ({ webOrigin, request }) => {
    // PWA install prompt requirements per Chrome:
    //   - name (or short_name)
    //   - start_url
    //   - display in {standalone, fullscreen, minimal-ui}
    //   - at least one icon ≥ 192px
    const resp = await request.get(`${webOrigin}/manifest.webmanifest`);
    expect(resp.status(), 'manifest must be served').toBe(200);
    // Vite preview defaults to `application/manifest+json` for .webmanifest.
    // Some static hosts will serve `text/json` — both are acceptable to
    // browsers, but anything HTML-ish would mean a routing fallback fired
    // and the actual manifest was masked.
    const ctype = resp.headers()['content-type'] ?? '';
    expect(ctype, `unexpected Content-Type: ${ctype}`).toMatch(/json|manifest/);

    const manifest = (await resp.json()) as {
      name?: string;
      start_url?: string;
      display?: string;
      icons?: Array<{ src: string; sizes?: string }>;
    };
    expect(manifest.name, 'manifest missing `name`').toBeTruthy();
    expect(manifest.start_url, 'manifest missing `start_url`').toBeTruthy();
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);

    const icons = manifest.icons ?? [];
    const bigIcons = icons.filter((i) =>
      (i.sizes ?? '').split(/\s+/).some((s) => parseInt(s.split('x')[0] ?? '0', 10) >= 192)
    );
    expect(bigIcons.length, `no icon ≥ 192px in manifest icons: ${JSON.stringify(icons)}`).toBeGreaterThan(0);
  });

  test('index.html links manifest, theme-color, apple-touch-icon, viewport-fit', async ({ page, webOrigin }) => {
    await page.goto(webOrigin);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);

    // We declare three theme-color metas: a default plus light/dark variants.
    const themeMetaCount = await page.locator('meta[name="theme-color"]').count();
    expect(themeMetaCount, 'no theme-color metas — install/theme broken').toBeGreaterThanOrEqual(1);

    // viewport-fit=cover is required for iOS to inset under the notch
    // without breaking layout. App.svelte assumes safe-area insets work.
    const viewport = (await page.locator('meta[name="viewport"]').getAttribute('content')) ?? '';
    expect(viewport, `viewport meta missing viewport-fit=cover: ${viewport}`).toContain('viewport-fit=cover');
  });

  test('every icon URL in the manifest actually resolves to an image', async ({ webOrigin, request }) => {
    // A 404 here is the usual cause of `chrome://flags Install` showing
    // `(no icons)` after a deploy.
    const manifest = (await (await request.get(`${webOrigin}/manifest.webmanifest`)).json()) as {
      icons?: Array<{ src: string }>;
    };
    for (const icon of manifest.icons ?? []) {
      const url = icon.src.startsWith('http') ? icon.src : `${webOrigin}${icon.src}`;
      const r = await request.get(url);
      expect(r.status(), `icon ${icon.src} → HTTP ${r.status()}`).toBe(200);
      const ctype = r.headers()['content-type'] ?? '';
      expect(ctype, `icon ${icon.src} not served as image/*: ${ctype}`).toMatch(/^image\//);
    }
  });

  test('app renders in standalone display mode', async ({ page, webOrigin }) => {
    // Once installed, the PWA runs in display-mode: standalone. Make sure
    // the app's empty-state shell renders correctly under that media
    // query — a regression here means a broken first-run for installed
    // users. Playwright doesn't expose display-mode directly, so override
    // `matchMedia` to claim standalone matches; CSS rules that target
    // `@media (display-mode: standalone)` will then apply.
    await page.emulateMedia({ media: 'screen', colorScheme: 'light' });
    await page.addInitScript(() => {
      const orig = window.matchMedia;
      window.matchMedia = (q: string): MediaQueryList => {
        if (typeof q === 'string' && q.includes('display-mode: standalone')) {
          return {
            matches: true,
            media: q,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent() {
              return false;
            },
          } as unknown as MediaQueryList;
        }
        return orig.call(window, q);
      };
    });
    await page.goto(webOrigin);
    await page.waitForLoadState('networkidle');

    // The disconnected empty-state CTA in InboxGrid is the standalone-mode
    // first-paint smoke check — proves the shell renders under the
    // installed-app media query.
    await expect(
      page.getByRole('button', { name: 'Connect to your remoteStorage' })
    ).toBeVisible();
  });
});
