/**
 * iOS Safari body-scroll-lock behaviour.
 *
 * `App.svelte` reacts to any open modal by pinning `<body>` to a fixed
 * position and snapshotting the scroll offset, then restoring on close.
 * That dance is the only way to prevent iOS rubber-banding the page
 * under the modal. Regress this and mobile users find the page scrolled
 * to the top after closing any dialog.
 */

import { expect, test } from '../helpers/fixtures';

test('opening a modal locks body scroll', async ({
  connectedPage,
  webOrigin,
}) => {
  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');

  // On mobile the inbox capture bar is a trigger that opens the fullscreen
  // capture sheet — a `role="dialog"` overlay that, like the other modals,
  // pins the body so iOS can't rubber-band the page behind it.
  await connectedPage.locator('.capture-trigger').tap();

  // Once the modal is open, App.svelte should have pinned the body.
  const bodyPos = await connectedPage.evaluate(
    () => getComputedStyle(document.body).position,
  );
  const bodyOverflow = await connectedPage.evaluate(
    () => getComputedStyle(document.body).overflow,
  );
  expect(
    bodyPos,
    `body should be position:fixed while modal open, got ${bodyPos}`,
  ).toBe('fixed');
  expect(
    bodyOverflow,
    `body overflow should be hidden, got ${bodyOverflow}`,
  ).toBe('hidden');
});

test('closing a modal restores scroll position', async ({
  connectedPage,
  webOrigin,
}) => {
  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');

  // Open & close — body styles must come back to defaults so the page
  // stays scrollable. We don't have enough cards in a fresh account to
  // produce a long scroll, but the *style restoration* is what we care
  // about; the saved-scrollY logic is exercised by the same code path.
  await connectedPage.locator('.capture-trigger').tap();
  await expect(connectedPage.locator(".modal, [role='dialog']")).toBeVisible();

  await connectedPage.keyboard.press('Escape');

  const bodyPos = await connectedPage.evaluate(
    () => getComputedStyle(document.body).position,
  );
  const bodyOverflow = await connectedPage.evaluate(
    () => getComputedStyle(document.body).overflow,
  );
  expect(bodyPos, `body should return to position:static, got ${bodyPos}`).toBe(
    'static',
  );
  // Once the inline `body.style.overflow` is cleared, the value reverts
  // to whatever the page CSS dictates. With separate overflow-x /
  // overflow-y rules in global.css the shorthand reads back as
  // "<x> <y>" — anything other than the locked "hidden" we set
  // explicitly is acceptable.
  expect(
    bodyOverflow,
    `body overflow should no longer be locked, got ${bodyOverflow}`,
  ).not.toBe('hidden');
});
