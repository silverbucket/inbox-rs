/**
 * Helpers for inbox-rs as a Progressive Web App.
 *
 * - `seedRsSession(...)` — bypasses the connect widget by writing the same
 *   localStorage entries that remotestorage.js writes after a successful
 *   OAuth round-trip, so a test starts already-authenticated.
 *
 * - `attachConsoleCapture(...)` / `assertNoConsoleErrors(...)` — capture
 *   browser console + page-error events into a shared array and assert
 *   against it at the end of a test, ignoring known-noise lines.
 */

import type { BrowserContext, Page } from '@playwright/test';

import { ARMADIETTO_ORIGIN, type RsUser } from './armadietto';

// Keys mirror what remotestoragejs writes after a real OAuth callback,
// determined by reading `node_modules/remotestoragejs/src/wireclient.ts`:
//
//   - `remotestorage:backend`  — single string, the backend type
//   - `remotestorage:wireclient` — single JSON blob holding the wireclient
//     state (userAddress, href, storageApi, token, properties). On boot the
//     wireclient does `getJSONFromLocalStorage(SETTINGS_KEY)` and re-applies
//     the values via `configure(...)`, which fires the `connected` event.
//
// We also seed the web app's own keys (`inbox-rs:userAddress`,
// `inbox-rs:theme`) so the UI shows the connected state on first paint
// without flashing the disconnected one.
function rsLocalStoragePayload(user: RsUser, token: string): Record<string, string> {
  const storageHref = `${ARMADIETTO_ORIGIN}/storage/${user.username}`;
  const wireclientSettings = {
    userAddress: user.address,
    href: storageHref,
    storageApi: 'draft-dejong-remotestorage-10',
    token,
    properties: {
      'http://remotestorage.io/spec/version': 'draft-dejong-remotestorage-10',
      'http://tools.ietf.org/html/rfc6750#section-2.3': true,
      'http://tools.ietf.org/html/rfc6749#section-4.2': `${ARMADIETTO_ORIGIN}/oauth/${user.username}`,
    },
  };
  return {
    'remotestorage:backend': 'remotestorage',
    'remotestorage:wireclient': JSON.stringify(wireclientSettings),
    // Web-app private keys — keep `applyTheme` happy on cold load and let
    // the connect widget render the user address before RS finishes its
    // async restore handshake.
    'inbox-rs:userAddress': user.address,
    'inbox-rs:theme': 'system',
  };
}

/**
 * Pre-populate the browser context with an authorized RS session.
 *
 * Must be called *before* the page navigates to the app. Internally uses
 * `addInitScript`, which fires before any page script — so by the time
 * the web app's `RemoteStorage` constructor runs, the auth state is in
 * place and the connect widget skips straight to the connected UI.
 */
export async function seedRsSession(
  context: BrowserContext,
  user: RsUser,
  token: string,
  // `clientOrigin` is currently unused in the payload but is required at the
  // call site to make the contract obvious: this seed only matches the OAuth
  // grant Armadietto issued for that origin. Keeping it on the signature
  // means a future RS-server flavour that needs the client_id distinct from
  // the web origin can wire it through without a breaking API change.
  _options: { clientOrigin: string }
): Promise<void> {
  const payload = rsLocalStoragePayload(user, token);
  await context.addInitScript((entries) => {
    for (const [k, v] of Object.entries(entries)) {
      try {
        localStorage.setItem(k, v as string);
      } catch {
        // Storage quota or disabled — nothing useful to do here.
      }
    }
  }, payload);
}

/**
 * Console + page-error capture. Returns the live array; assert against it
 * with `assertNoConsoleErrors(...)` after your interactions.
 */
export function attachConsoleCapture(page: Page): string[] {
  const log: string[] = [];
  page.on('console', (msg) => log.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (exc) => log.push(`[pageerror] ${exc.message}`));
  return log;
}

/**
 * Fail the test if any captured console message looks like a real error.
 *
 * The web app legitimately logs `console.error('Failed to sync URL filters …', e)`
 * on bootstrap when configs aren't loaded yet, so we can't fail on the
 * bare presence of an `[error]` entry. Filter against a known-noise list.
 */
export function assertNoConsoleErrors(messages: readonly string[]): void {
  const noiseSubstrings = [
    // Vite injects this on dev builds when the page is opened directly;
    // production preview shouldn't emit it but we keep it harmless.
    '[vite] connecting',
    // Service worker registration messages from Chrome DevTools when no
    // SW is installed — purely informational.
    'Failed to load resource: the server responded with a status of 404',
  ];
  const realErrors = messages.filter(
    (m) => m.startsWith('[error]') && !noiseSubstrings.some((s) => m.includes(s))
  );
  if (realErrors.length > 0) {
    throw new Error(`Unexpected console errors:\n${realErrors.join('\n')}`);
  }
}
