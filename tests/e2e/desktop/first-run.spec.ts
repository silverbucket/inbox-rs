/**
 * First-run paths from the UX study.
 *
 * - A disconnected, empty inbox explains itself and offers a primary
 *   "Connect storage" button instead of an "Inbox zero" celebration.
 * - A brand-new account (no groups yet) can create its first collection
 *   straight from the New collection form, in both shells — the form makes
 *   the group too, so nothing depends on the classic-only filter bar.
 */

import { expect, test } from '../helpers/fixtures';
import {
  assertNoConsoleErrors,
  attachConsoleCapture,
  seedRsSession,
} from '../helpers/pwa';

test('disconnected empty inbox shows a first-run connect state', async ({
  page,
  webOrigin,
}) => {
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole('heading', { name: 'Inbox zero' })).toHaveCount(
    0,
  );
  await expect(page.getByText("You're all caught up")).toHaveCount(0);
  const cta = page
    .getByRole('main')
    .getByRole('button', { name: 'Connect storage' });
  await expect(cta).toBeVisible();

  // The CTA opens the Account section with the address field ready.
  await cta.click();
  await expect(page.getByPlaceholder('user@storage.example')).toBeFocused();
});

test('connected empty inbox still says Inbox zero', async ({
  context,
  page,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Inbox zero' })).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('button', { name: 'Connect storage' }),
  ).toHaveCount(0);
});

for (const layout of ['sidebar', 'classic'] as const) {
  test(`${layout}: first collection can be created with a new group from the form`, async ({
    context,
    page,
    freshRsUser,
    freshRsToken,
    webOrigin,
  }) => {
    await seedRsSession(context, freshRsUser, freshRsToken, {
      clientOrigin: webOrigin,
    });
    await context.addInitScript(
      (l) => localStorage.setItem('inbox-rs:layout', l),
      layout,
    );
    const log = attachConsoleCapture(page);
    await page.goto(`${webOrigin}/#/collections`);
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByRole('button', { name: 'User menu — connected' }),
    ).toBeVisible();

    // The empty state must not send people to a control that may not exist.
    const empty = page.locator('.page-empty');
    await expect(empty).toBeVisible();
    await expect(empty).not.toContainText('filter bar');

    await page.getByRole('button', { name: 'New collection' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('e.g. Reading List').fill('Reading list');

    // No group yet: Create is disabled and says why.
    const create = dialog.getByRole('button', { name: 'Create', exact: true });
    await expect(create).toBeDisabled();
    await expect(
      dialog.getByText('Name the new group to create'),
    ).toBeVisible();

    await dialog.getByLabel('New group name').fill('Reading');
    await expect(create).toBeEnabled();
    await create.click();

    await expect(dialog).toHaveCount(0);
    const main = page.locator('.collections-page');
    await expect(main.getByText('Reading list').first()).toBeVisible();
    await expect(
      main.getByText('Reading', { exact: true }).first(),
    ).toBeVisible();

    // The group and collection each land in one write: a second PUT right
    // after the first 412s and the collection drops out of its group.
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(main.getByText('Reading list').first()).toBeVisible();
    await expect(page.locator('.page-empty')).toHaveCount(0);
    assertNoConsoleErrors(log);
  });
}
