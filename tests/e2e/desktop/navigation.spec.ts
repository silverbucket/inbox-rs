/**
 * Hash-based routing on desktop.
 *
 * App.svelte parses `window.location.hash` to decide which page to render.
 * We exercise every nav button, plus deep-linking via the URL bar.
 */

import { expect, test } from '../helpers/fixtures';
import { assertNoConsoleErrors, attachConsoleCapture } from '../helpers/pwa';

test('default route renders inbox empty state', async ({ page, webOrigin }) => {
  const log = attachConsoleCapture(page);
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  // Disconnected → empty state, but the header nav must still be present.
  await expect(page.getByRole('button', { name: 'Inbox' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collections' })).toBeVisible();
  // The disconnected empty state lives in InboxGrid: the heading is "Inbox
  // zero" with a "Connect to your remoteStorage" CTA below. The CTA only
  // renders when not connected, so it's the unambiguous disconnected marker.
  await expect(
    page.getByRole('button', { name: 'Connect to your remoteStorage' }),
  ).toBeVisible();
  assertNoConsoleErrors(log);
});

test('plugins page loads when disconnected', async ({ page, webOrigin }) => {
  // The Plugins / Downloads page is the one route that should work
  // *without* a connection — it's how users get the extension.
  await page.goto(`${webOrigin}/#/plugins`);
  await page.waitForLoadState('networkidle');

  // The footer Downloads link, when active, mirrors the route — confirm
  // it's marked active so we know route parsing landed on plugins.
  const downloads = page.locator('.footer-link', { hasText: 'Downloads' });
  await expect(downloads).toHaveClass(/active/);
});

test('nav buttons swap routes when connected', async ({
  connectedPage,
  webOrigin,
}) => {
  // Click each top nav button in turn and assert the URL hash and
  // `aria-current=page` track. This is the user-facing contract that
  // the `parseHash` / `formatRoute` unit tests can't see.
  const log = attachConsoleCapture(connectedPage);
  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');

  // Wait for the connected UI to be present — the nav exists in both
  // states but the disconnected CTA is gone only after RS attaches.
  await expect(
    connectedPage.getByRole('button', {
      name: 'Connect to your remoteStorage',
    }),
  ).toHaveCount(0);

  // Each (label, hash-suffix) pair: hash-suffix is what `parseHash`
  // writes back. `?g=...` filter params can follow on todos/collections,
  // so we match a prefix not the exact value.
  const cases: ReadonlyArray<{ label: string; hashSuffix: string }> = [
    { label: 'Todos', hashSuffix: 'todos' },
    { label: 'Collections', hashSuffix: 'collections' },
    { label: 'Inbox', hashSuffix: '' },
  ];
  for (const { label, hashSuffix } of cases) {
    await connectedPage.getByRole('button', { name: label }).first().click();
    if (hashSuffix) {
      await expect(connectedPage).toHaveURL(
        new RegExp(`#/${hashSuffix}(?:\\?.*)?$`),
      );
    } else {
      await expect(connectedPage).toHaveURL(/#\/?$/);
    }
    const active = connectedPage.getByRole('button', { name: label }).first();
    await expect(active).toHaveAttribute('aria-current', 'page');
  }

  assertNoConsoleErrors(log);
});

test('unknown hash falls back to inbox', async ({
  connectedPage,
  webOrigin,
}) => {
  // `parseHash` treats unknown paths as inbox. Verify that's wired all
  // the way through the UI, not just the parser.
  await connectedPage.goto(`${webOrigin}/#/this-route-does-not-exist`);
  await connectedPage.waitForLoadState('networkidle');

  const inboxBtn = connectedPage.getByRole('button', { name: 'Inbox' });
  await expect(inboxBtn).toHaveAttribute('aria-current', 'page');
});
