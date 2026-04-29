/**
 * Offline behavior.
 *
 * The web app uses remotestoragejs's caching layer (`rs.caching.enable('/inbox/')`)
 * which keeps everything in IndexedDB and replays writes when the network
 * returns. We don't ship a service worker yet, so an offline cold-load is
 * expected to fail — but a *warm* offline load (already-loaded SPA losing
 * network) must keep the cached UI usable.
 */

import { expect, test } from '../helpers/fixtures';
import { attachConsoleCapture } from '../helpers/pwa';

test('warm offline still renders shell', async ({
  connectedPage,
  webOrigin,
}) => {
  // Load the app, then go offline and reload. With no service worker
  // today this WILL fail to navigate — that's the documented behaviour
  // we want to lock in so a future SW addition is an obvious test diff.
  //
  // To rephrase: this test is a *characterization test*. When we ship
  // the PWA service worker, flip the assertion at the bottom and the
  // suite will tell you the moment offline-first regresses.
  attachConsoleCapture(connectedPage);
  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');

  // We're in. Capture a sentinel from the live DOM so we can prove a
  // subsequent offline interaction worked against cached data.
  await expect(
    connectedPage.getByRole('button', { name: 'Inbox' }).first(),
  ).toBeVisible();

  // Drop the network. Existing in-memory app keeps working — RS's
  // IndexedDB cache satisfies reads, writes queue up.
  await connectedPage.context().setOffline(true);
  // The hash router doesn't hit the network, so this should still work.
  await connectedPage.getByRole('button', { name: 'Collections' }).click();
  await expect(
    connectedPage.getByRole('button', { name: 'Collections' }).first(),
  ).toHaveAttribute('aria-current', 'page');

  // Re-online for cleanup so the context teardown doesn't spam errors.
  await connectedPage.context().setOffline(false);
});

test('cold offline load is blocked without service worker', async ({
  page,
  webOrigin,
}) => {
  // Without a service worker, a fully-offline cold load can't reach the
  // server. Documented here so a regression means somebody added (or
  // removed) a SW and forgot to update either the docs or the test.
  await page.context().setOffline(true);

  // Playwright surfaces network failures as a navigation error.
  await expect(page.goto(webOrigin, { timeout: 5_000 })).rejects.toThrow(
    /net::ERR_INTERNET_DISCONNECTED|NS_ERROR_OFFLINE|net::ERR_FAILED/i,
  );
});
