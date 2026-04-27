/**
 * Offline → online → connect transitions.
 *
 * Both scenarios start with the disconnected app shell loaded online (we
 * don't ship a service worker yet, so a *cold* offline load is expected
 * to fail — see `offline-resilience.spec.ts`). The network is then
 * dropped to exercise the "user opened the page on a flaky connection"
 * path, brought back, and the connect flow runs to completion.
 *
 * We cover the two account states that matter for first-time UX:
 *
 * 1. **New account, no data** — drives the real OAuth UI to register
 *    the session, then asserts the connected empty state surfaces.
 * 2. **Existing account with data** — pre-seeds one note via a direct
 *    PUT to the RS server before the page ever opens, connects via the
 *    seeded localStorage shortcut, and asserts the note syncs down and
 *    renders.
 *
 * Both tests use a *fresh* per-test Armadietto user (`freshRsUser`) so
 * they can't be perturbed by other tests writing to the shared worker
 * account. See `helpers/fixtures.ts` for the fixture rationale.
 */

import { test, expect } from '../helpers/fixtures';
import { putInboxItem } from '../helpers/armadietto';
import { seedRsSession } from '../helpers/pwa';

test('offline → online → connect with a brand-new account', async ({ page, freshRsUser, webOrigin }) => {
  // User opens the app on a flaky connection, drops offline, comes back,
  // and connects for the first time. End state: connected, empty inbox.
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  // Disconnected at first paint, then we yank the network.
  await expect(page.getByRole('heading', { name: 'Connect your storage' })).toBeVisible();
  await page.context().setOffline(true);

  // Disconnected UI must keep working with no network — the empty state
  // is fully static and hash routing doesn't hit the wire.
  await expect(page.getByRole('heading', { name: 'Connect your storage' })).toBeVisible();
  await page.getByRole('button', { name: 'Collections' }).first().click();
  await expect(
    page.getByRole('button', { name: 'Collections' }).first()
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Inbox' }).first().click();

  // Network's back. Drive the real OAuth flow (mirrors connect-flow.spec.ts)
  // so we cover the connect transition under post-offline conditions.
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'User menu — disconnected' }).click();
  await page.getByPlaceholder('user@storage.example').fill(freshRsUser.address);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  await page.waitForURL(/^http:\/\/localhost:8000\/oauth\//, { timeout: 10_000 });
  await page.locator('input[name="password"]').fill(freshRsUser.password);
  await page.locator('button[name="allow"]').click();

  await page.waitForURL(`${webOrigin}/**`, { timeout: 10_000 });
  await page.waitForLoadState('networkidle');

  // Connected state: aria-label flips, empty-state heading is gone.
  await expect(page.getByRole('button', { name: 'User menu — connected' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connect your storage' })).toHaveCount(0);
});

test('offline → online → connect with an existing account that has data', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  // After the connect transition, a successful sync must surface the
  // pre-existing note in the inbox grid — proves the
  // `getAll('items/')` → change-event → render pipeline works on a cold
  // first connect, not just for items the same browser wrote.
  const sentinel = 'preexisting-note-α-from-another-device';
  await putInboxItem(freshRsUser, freshRsToken, {
    item: {
      id: 'preexisting-note-1',
      type: 'note',
      title: sentinel,
      body: sentinel,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  });

  const page = await context.newPage();
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  // Disconnected first, then drop the network.
  await expect(page.getByRole('heading', { name: 'Connect your storage' })).toBeVisible();
  await context.setOffline(true);

  // Hash navigation must keep working offline.
  await page.getByRole('button', { name: 'Collections' }).first().click();
  await expect(
    page.getByRole('button', { name: 'Collections' }).first()
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Inbox' }).first().click();

  // Network returns. Seed the auth state and reload — the seed only
  // takes effect on the next navigation because `addInitScript` runs
  // before page scripts; a simple in-place setItem wouldn't survive
  // the reload that triggers RS's connection handshake.
  await context.setOffline(false);
  await seedRsSession(context, freshRsUser, freshRsToken, { clientOrigin: webOrigin });
  await page.reload();
  await page.waitForLoadState('networkidle');

  // Connected, and the pre-seeded note must surface after RS finishes
  // its initial sync. Sync timing varies on a cold connection so we
  // give it a generous deadline.
  await expect(page.getByRole('button', { name: 'User menu — connected' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(sentinel)).toBeVisible({ timeout: 15_000 });
});
