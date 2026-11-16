/**
 * A board's columns are edited where you see them: each column's header
 * menu renames it and picks the Finished column, with no trip to Settings.
 * Asserted on the server, since the board is shared across devices.
 */

import { ARMADIETTO_ORIGIN, type RsUser } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

async function serverSets(user: RsUser, token: string) {
  const r = await fetch(
    `${ARMADIETTO_ORIGIN}/storage/${user.username}/inbox/config/app`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const config = r.ok
    ? ((await r.json()) as {
        columnSets?: Array<{
          name: string;
          columns: Array<{ name: string; done?: boolean }>;
        }>;
      })
    : {};
  return config.columnSets ?? [];
}

test('a column is renamed and made the Finished column from its own menu', async ({
  context,
  webOrigin,
  freshRsUser,
  freshRsToken,
}) => {
  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const page = await context.newPage();
  await page.goto(`${webOrigin}/#/collections`);
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'New collection' }).first().click();
  await page.getByPlaceholder('e.g. Reading List').fill('Books');
  await page.getByPlaceholder('e.g. Personal').fill('Home');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Focus on Books' }).click();
  await page
    .getByRole('group', { name: 'View' })
    .getByRole('button', { name: 'Board', exact: true })
    .click();
  await page.getByRole('button', { name: 'Reading list', exact: true }).click();
  await page.getByRole('button', { name: 'Create board', exact: true }).click();

  // Rename "Reading" in place.
  await page
    .getByRole('button', { name: 'Column options for Reading' })
    .click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const field = page.getByRole('textbox', { name: 'Column name' });
  await field.fill('In progress');
  await field.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'In progress', exact: true }),
  ).toBeVisible();

  // Make it the Finished column: the tag moves over from "Read".
  await page
    .getByRole('button', { name: 'Column options for In progress' })
    .click();
  await page
    .getByRole('menuitemcheckbox', { name: /Make this the Finished column/ })
    .click();
  const column = (name: string) =>
    page.locator('section.column', {
      has: page.getByRole('heading', { name, exact: true }),
    });
  await expect(column('In progress').getByText('Finished')).toBeVisible();
  await expect(column('Read').getByText('Finished')).toHaveCount(0);

  await expect
    .poll(
      async () => {
        const set = (await serverSets(freshRsUser, freshRsToken)).find(
          (s) => s.name === 'Reading list',
        );
        return set?.columns.filter((c) => c.done).map((c) => c.name);
      },
      { timeout: 20_000 },
    )
    .toEqual(['In progress']);
});
