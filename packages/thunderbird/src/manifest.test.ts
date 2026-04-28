import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Manifest invariants for the Thunderbird extension.
 *
 * REGRESSION: the manifest was originally shipped without any host match
 * patterns. In MV2, host permissions live inline in `permissions`, and
 * without them every cross-origin `fetch()` from the moz-extension origin
 * (WebFinger discovery, OAuth redirect handling, RS PUTs) is subject to
 * standard CORS — which the local Armadietto dev server and many providers
 * fail. The user could never get past the "Connect" step. These tests pin
 * the manifest contract so the regression cannot recur silently.
 */

const manifestPath = resolve(__dirname, '..', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

describe('thunderbird manifest', () => {
  it('targets MV2 (Thunderbird does not support MV3 yet)', () => {
    expect(manifest.manifest_version).toBe(2);
  });

  it('declares an applications.gecko.id and minimum Thunderbird version', () => {
    expect(manifest.applications?.gecko?.id).toMatch(/^[\w.+-]+@[\w.-]+$/);
    expect(manifest.applications?.gecko?.strict_min_version).toBeDefined();
  });

  describe('permissions', () => {
    it('declares messagesRead so we can read the displayed email', () => {
      expect(manifest.permissions).toContain('messagesRead');
    });

    it('declares storage so the config can be persisted in browser.storage.local', () => {
      expect(manifest.permissions).toContain('storage');
    });

    it('declares identity so OAuth via launchWebAuthFlow works', () => {
      expect(manifest.permissions).toContain('identity');
    });

    /**
     * REGRESSION: without a host match pattern, both
     *   1. the WebFinger fetch in connectViaOAuth, and
     *   2. every PUT made by DirectRS during save,
     * are blocked by CORS for any RS provider that doesn't ship permissive
     * headers (notably the local Armadietto dev server). The user reports
     * "I can't even log in" because step 1 fails.
     */
    it('declares <all_urls> (or equivalent host patterns) so fetch can reach any RS host', () => {
      const perms: string[] = manifest.permissions;
      const hasAllUrls = perms.includes('<all_urls>');
      const hasWildcardHttps = perms.some((p) => p.startsWith('https://') || p.startsWith('http://'));
      expect(hasAllUrls || hasWildcardHttps).toBe(true);
    });
  });

  it('declares a message_display_action with a popup', () => {
    expect(manifest.message_display_action?.default_popup).toBe('src/popup/index.html');
  });

  it('declares an options page (so the user can set up RS auth)', () => {
    expect(manifest.options_ui?.page).toBe('src/options/index.html');
  });

  it('declares a background script', () => {
    expect(manifest.background?.scripts).toContain('background.js');
  });
});
