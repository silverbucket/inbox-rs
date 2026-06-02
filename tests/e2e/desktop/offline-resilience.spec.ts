/**
 * Offline behavior.
 *
 * The web app uses remotestoragejs's caching layer (`rs.caching.enable('/inbox/')`)
 * which keeps everything in IndexedDB and replays writes when the network
 * returns. A Workbox service worker precaches the app shell so reloads work
 * offline after one online visit.
 */

import { expect, test } from '../helpers/fixtures';
import {
  attachConsoleCapture,
  waitForServiceWorkerController,
} from '../helpers/pwa';

test('warm offline still renders shell', async ({
  connectedPage,
  webOrigin,
}) => {
  attachConsoleCapture(connectedPage);
  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');
  await waitForServiceWorkerController(connectedPage);

  await expect(
    connectedPage.getByRole('button', { name: 'Inbox' }).first(),
  ).toBeVisible();

  await connectedPage.context().setOffline(true);

  await connectedPage.getByRole('button', { name: 'Collections' }).click();
  await expect(
    connectedPage.getByRole('button', { name: 'Collections' }).first(),
  ).toHaveAttribute('aria-current', 'page');

  const reload = await connectedPage.reload({
    waitUntil: 'domcontentloaded',
    timeout: 15_000,
  });
  expect(reload?.ok()).toBeTruthy();
  await expect(
    connectedPage.getByRole('button', { name: 'Inbox' }).first(),
  ).toBeVisible();

  await connectedPage.context().setOffline(false);
});

test('cold offline load fails without a prior visit', async ({
  page,
  webOrigin,
}) => {
  await page.context().setOffline(true);

  await expect(page.goto(webOrigin, { timeout: 5_000 })).rejects.toThrow(
    /net::ERR_INTERNET_DISCONNECTED|NS_ERROR_OFFLINE|net::ERR_FAILED/i,
  );
});

test('offline reload serves app shell after service worker install', async ({
  page,
  webOrigin,
}) => {
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');
  await waitForServiceWorkerController(page);

  await page.context().setOffline(true);

  const reload = await page.reload({
    waitUntil: 'domcontentloaded',
    timeout: 15_000,
  });
  expect(reload?.ok()).toBeTruthy();
  await expect(
    page.getByRole('button', { name: 'Inbox' }).first(),
  ).toBeVisible();

  await page.context().setOffline(false);
});
