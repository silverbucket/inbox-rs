/**
 * Touch-input behaviour on mobile.
 *
 * The mobile project profile runs with `hasTouch: true` and `isMobile:
 * true`, so Playwright dispatches `touchstart`/`touchend` instead of
 * mouse events when we use `tap()`. This catches handlers that only
 * listen to `click` and break in mobile Safari — a recurring class of
 * bug in PWAs.
 */

import type { InboxItem } from '@inbox-rs/rs-module';
import { putInboxItem } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';

test('tap opens settings and pushes the account screen', async ({
  page,
  webOrigin,
}) => {
  // The settings trigger and tile must respond to taps. If either only listens for
  // `click` events without the proper handler config, mobile Safari may
  // dispatch a 300 ms-delayed click and the test will time out — that's
  // the smoke we're catching.
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'User menu — disconnected' }).tap();
  await page.getByRole('button', { name: /^Account — Not connected/ }).tap();

  await expect(page.getByPlaceholder('user@storage.example')).toBeVisible();
});

test('tap navigates between pages', async ({
  connectedPage,
  rsUser,
  rsToken,
  webOrigin,
}) => {
  // Same coverage as the desktop nav test, but using touch dispatch. An open
  // todo makes the Todos page render its view switch, so the test can check
  // that the tab bar really changes the view, not just its own markers.
  await putInboxItem(rsUser, rsToken, {
    item: {
      id: 'tabbar-plan-todo',
      type: 'note',
      title: 'Tab bar plan todo',
      body: '',
      isTodo: true,
      completed: false,
      createdAt: new Date().toISOString(),
    } as unknown as InboxItem,
  });
  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');

  const tabbar = connectedPage.getByRole('navigation', {
    name: 'Primary (mobile)',
  });
  const todayBtn = tabbar.getByRole('button', { name: 'Today' });
  await todayBtn.tap();
  await expect(todayBtn).toHaveAttribute('aria-current', 'page');
  await expect(connectedPage).toHaveURL(/#\/todos/);

  const views = connectedPage.getByRole('group', { name: 'Todos view' });
  await expect(
    views.getByRole('button', { name: 'Today', includeHidden: true }),
  ).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });

  const planBtn = tabbar.getByRole('button', { name: 'Plan' });
  await planBtn.tap();
  await expect(planBtn).toHaveAttribute('aria-current', 'page');
  await expect(todayBtn).not.toHaveAttribute('aria-current', 'page');
  await expect(
    views.getByRole('button', {
      name: 'Plan',
      exact: true,
      includeHidden: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await views.getByRole('button', { name: 'Board view', exact: true }).tap();
  await expect(connectedPage.locator('main h1')).toHaveText('Board');
  await planBtn.tap();
  await expect(connectedPage.locator('main h1')).toHaveText('Plan');
});
