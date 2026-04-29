import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Manifest invariants for the Chrome (MV3) and Firefox (MV3) WebExtensions.
 *
 * The popup and service worker depend on `host_permissions: <all_urls>` to
 * make cross-origin `fetch()` calls (WebFinger discovery, RS PUTs to
 * arbitrary remote storage hosts, image downloads in the SW round-trip).
 * If host permissions disappear, the popup save will fail in production but
 * type-check + build cleanly — exactly the kind of silent breakage tests
 * should catch. Both manifest variants are pinned here.
 */

const chromeManifestPath = resolve(__dirname, '..', 'manifest.json');
const firefoxManifestPath = resolve(__dirname, '..', 'manifest.firefox.json');

const chromeManifest = JSON.parse(readFileSync(chromeManifestPath, 'utf-8'));
const firefoxManifest = JSON.parse(readFileSync(firefoxManifestPath, 'utf-8'));

const variants: Array<[string, any]> = [
  ['chrome (manifest.json)', chromeManifest],
  ['firefox (manifest.firefox.json)', firefoxManifest],
];

describe.each(variants)('extension manifest — %s', (_label, manifest) => {
  it('targets MV3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  describe('permissions', () => {
    it('declares activeTab so the popup can read the active page', () => {
      expect(manifest.permissions).toContain('activeTab');
    });

    it('declares contextMenus so the right-click "Save to Inbox" menus work', () => {
      expect(manifest.permissions).toContain('contextMenus');
    });

    it('declares storage so the RS config is persisted in browser.storage.local', () => {
      expect(manifest.permissions).toContain('storage');
    });

    it('declares identity so OAuth via launchWebAuthFlow works', () => {
      expect(manifest.permissions).toContain('identity');
    });
  });

  /**
   * REGRESSION: the popup's save flow PUTs to the user's arbitrary RS host.
   * Without host_permissions declared, MV3 enforces CORS preflight against
   * unrelated origins and the PUT (or its OPTIONS preflight) gets rejected.
   * The user reported "save just hangs" — this is one of the underlying
   * triggers we hardened the popup against.
   */
  it('declares host_permissions broad enough to reach any RS host', () => {
    const hostPerms: string[] = manifest.host_permissions ?? [];
    const hasAllUrls = hostPerms.includes('<all_urls>');
    const hasWildcardHttps = hostPerms.some(
      (p) => p === 'https://*/*' || p === 'http://*/*',
    );
    expect(hasAllUrls || hasWildcardHttps).toBe(true);
  });

  it('declares an action with a popup', () => {
    expect(manifest.action?.default_popup).toBe('src/popup/index.html');
  });

  it('declares an options page (so the user can set up RS auth)', () => {
    expect(manifest.options_page).toBe('src/options/index.html');
  });

  it('declares a content script that runs on all URLs at document_idle', () => {
    const cs = manifest.content_scripts?.[0];
    expect(cs?.matches).toContain('<all_urls>');
    expect(cs?.run_at).toBe('document_idle');
    expect(cs?.js).toContain('content-metadata.js');
  });

  it('declares a service worker as the background script', () => {
    // Chrome MV3 requires `service_worker`; Firefox MV3 accepts the
    // `scripts` array form. Either is fine — what matters is that *some*
    // background entrypoint is declared so the SW message handlers run.
    const bg = manifest.background;
    const hasServiceWorker = typeof bg?.service_worker === 'string';
    const hasScripts = Array.isArray(bg?.scripts) && bg.scripts.length > 0;
    expect(hasServiceWorker || hasScripts).toBe(true);
  });
});

describe('firefox-specific manifest invariants', () => {
  it('declares browser_specific_settings.gecko.id (required by AMO)', () => {
    expect(firefoxManifest.browser_specific_settings?.gecko?.id).toMatch(
      /^[\w.+-]+@[\w.-]+$/,
    );
  });
});
