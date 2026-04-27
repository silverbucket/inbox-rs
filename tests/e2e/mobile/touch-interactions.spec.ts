/**
 * Touch-input behaviour on mobile.
 *
 * The mobile project profile runs with `hasTouch: true` and `isMobile:
 * true`, so Playwright dispatches `touchstart`/`touchend` instead of
 * mouse events when we use `tap()`. This catches handlers that only
 * listen to `click` and break in mobile Safari — a recurring class of
 * bug in PWAs.
 */

import { test, expect } from '../helpers/fixtures';

test('tap opens the user menu', async ({ page, webOrigin }) => {
  // The user menu trigger must respond to a tap. If it only listens for
  // `click` events without the proper handler config, mobile Safari may
  // dispatch a 300 ms-delayed click and the test will time out — that's
  // the smoke we're catching.
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'User menu — disconnected' }).tap();

  await expect(page.getByPlaceholder('user@storage.example')).toBeVisible();
});

test('tap navigates between pages', async ({ connectedPage, webOrigin }) => {
  // Same coverage as the desktop nav test, but using touch dispatch.
  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');

  const todosBtn = connectedPage.getByRole('button', { name: 'Todos' }).first();
  await todosBtn.tap();
  await expect(todosBtn).toHaveAttribute('aria-current', 'page');
});
