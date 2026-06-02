/**
 * Offline behavior.
 *
 * The web app uses a service worker for the app shell and remotestoragejs's
 * caching layer (`rs.caching.enable('/inbox/')`) for data. Once the app has
 * loaded online and installed the service worker, a later offline launch should
 * still render the cached shell and local data.
 */

import { expect, test } from '../helpers/fixtures';
import { attachConsoleCapture } from '../helpers/pwa';

test('warm offline still renders shell', async ({
  connectedPage,
  webOrigin,
}) => {
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

test('installed app shell loads offline', async ({
  context,
  page,
  webOrigin,
}) => {
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('Timed out waiting for service worker')),
          5_000,
        );
      }),
    ]),
  );

  await context.setOffline(true);
  const offlinePage = await context.newPage();
  await offlinePage.goto(webOrigin);

  await expect(
    offlinePage.getByRole('button', { name: 'Inbox' }).first(),
  ).toBeVisible();

  await context.setOffline(false);
  await offlinePage.close();
});

test('first-ever offline load still requires one online visit', async ({
  browser,
  webOrigin,
}) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await context.setOffline(true);

    await expect(page.goto(webOrigin, { timeout: 5_000 })).rejects.toThrow(
      /net::ERR_INTERNET_DISCONNECTED|NS_ERROR_OFFLINE|net::ERR_FAILED/i,
    );
  } finally {
    await context.close();
  }
});
