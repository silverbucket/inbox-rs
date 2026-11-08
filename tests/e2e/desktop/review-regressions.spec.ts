import { expect, test } from '../helpers/fixtures';

test('collection actions disclose on phones and Show all resets actual filter scope', async ({
  connectedPage: page,
  webOrigin,
}) => {
  await page.goto(`${webOrigin}/#/collections`);
  for (const name of ['Work', 'Home']) {
    await page
      .getByRole('button', { name: /New group|Create your first group/ })
      .first()
      .click();
    await page.getByPlaceholder('Name a group…').fill(name);
    await page.keyboard.press('Enter');
  }
  await page
    .getByRole('button', { name: 'Add collection to Work', exact: true })
    .first()
    .click();
  await page.getByPlaceholder('Name a collection…').fill('Reference');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const header = page.locator('main .collection-header', {
    has: page.getByRole('heading', { name: 'Reference', exact: true }),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(header.locator('.header-actions')).toBeHidden();
  await header
    .getByRole('button', { name: 'Actions for Reference', exact: true })
    .click();
  await expect(header.locator('.header-actions')).toBeVisible();
  await expect(header).toHaveAccessibleDescription('0 reference items');
  await page.setViewportSize({ width: 1280, height: 900 });
  const home = page.locator('.group-row', {
    has: page.locator('.entity-name', { hasText: /^Home$/ }),
  });
  await home.locator('.group-entity').click();
  const scope = page.getByRole('group', {
    name: 'Current filters',
    exact: true,
  });
  await expect(scope).toContainText('1 of 2 groups');
  await scope.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(scope).toBeHidden();
  await expect(page).toHaveURL(`${webOrigin}/#/collections`);
  await page
    .getByRole('button', { name: 'New group', exact: true })
    .first()
    .click();
  await page.getByPlaceholder('Name a group…').fill('New after reset');
  await page.keyboard.press('Enter');
  await expect(
    page.locator('.group-row .entity-name', { hasText: /^New after reset$/ }),
  ).toBeVisible();
  await expect(scope).toBeHidden();
});
