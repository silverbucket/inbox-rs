/**
 * Regression: an open modal must survive same-page route churn.
 *
 * `route` is reassigned wholesale on every hashchange, including ones that
 * land on the page the user is already on — most commonly the *async*
 * hashchange event from a nav click being delivered a beat after the user
 * opened a modal. The close-modals-on-navigation effect used to key on the
 * route object, so that stale event instantly closed the just-opened
 * modal. In practice: click Inbox, attach a file, and the Add Image modal
 * flashed away (flaky, since it raced event delivery — the more the page
 * had to render, the likelier the loss).
 *
 * The fix keys the effect on the page *value*. This spec pins both sides:
 * a same-page hashchange keeps the modal open; navigating to a different
 * page still closes it.
 */

import { expect, test } from '../helpers/fixtures';
import { assertNoConsoleErrors, attachConsoleCapture } from '../helpers/pwa';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('an open modal survives a same-page hashchange but closes on real navigation', async ({
  connectedPage,
  webOrigin,
}) => {
  const log = attachConsoleCapture(connectedPage);
  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');
  await connectedPage.getByRole('button', { name: 'Inbox' }).first().click();

  // Open the Add Image modal via the capture bar's hidden file input —
  // the exact flow that raced the nav click's hashchange.
  await connectedPage.locator('.file-input').setInputFiles({
    name: 'regression.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });
  const dialog = connectedPage.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  // A same-page hashchange — what the delayed nav-click event delivers.
  await connectedPage.evaluate(() => {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  // The modal must not flinch. A short settle keeps this assertion honest —
  // the old bug closed it within one reactive flush.
  await connectedPage.waitForTimeout(200);
  await expect(dialog).toBeVisible();

  // Navigating to a *different* page still closes it.
  await connectedPage.evaluate(() => {
    window.location.hash = '#/todos';
  });
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });

  assertNoConsoleErrors(log);
});
