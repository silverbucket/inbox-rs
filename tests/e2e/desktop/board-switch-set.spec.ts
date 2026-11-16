/**
 * Switching a collection to another board finishes cleanly: the dialog
 * closes, the collection says which board it now uses, and the server
 * agrees. The move used to succeed and then trip over its own success
 * message, leaving the dialog open under an error toast.
 */

import type { Collection } from '@inbox-rs/rs-module';
import {
  ARMADIETTO_ORIGIN,
  getInboxFolder,
  type RsUser,
} from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';

async function serverSets(user: RsUser, token: string) {
  const r = await fetch(
    `${ARMADIETTO_ORIGIN}/storage/${user.username}/inbox/config/app`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const config = r.ok
    ? ((await r.json()) as {
        columnSets?: Array<{ id: string; name: string }>;
      })
    : {};
  return config.columnSets ?? [];
}

test('switching a collection to another board closes the dialog and sticks', async ({
  connectedPage,
  webOrigin,
  rsUser,
  rsToken,
}) => {
  const page = connectedPage;
  const stamp = Date.now();
  const movies = `Movies ${stamp}`;
  const books = `Books ${stamp}`;
  const watch = `Watching ${stamp}`;
  const reading = `Reading ${stamp}`;

  await page.goto(`${webOrigin}/#/collections`);
  await page.waitForLoadState('networkidle');

  // Two collections, each with a board of its own.
  for (const [name, template, set] of [
    [movies, 'Watch list', watch],
    [books, 'Reading list', reading],
  ]) {
    await page.getByRole('button', { name: 'New collection' }).first().click();
    await page.getByPlaceholder('e.g. Reading List').fill(name);
    const newGroup = page.getByPlaceholder('e.g. Personal');
    if (await newGroup.isVisible()) await newGroup.fill(`Home ${stamp}`);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: `Focus on ${name}` }).click();
    await page
      .getByRole('group', { name: 'View' })
      .getByRole('button', { name: 'Board', exact: true })
      .click();
    await page.getByRole('button', { name: template, exact: true }).click();
    await page.locator('#set-name').fill(set);
    await page
      .getByRole('button', { name: 'Create board', exact: true })
      .click();
    await expect(page.getByText(`Saved ${set}.`)).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
  }

  // Movies switches to the Reading board.
  await page.getByRole('button', { name: `Focus on ${movies}` }).click();
  await page.getByRole('button', { name: 'Board settings' }).first().click();
  await page
    .getByRole('button', { name: 'Switch to a different board…' })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Switch to a different board',
  });
  await dialog
    .getByLabel('Switch to', { exact: true })
    .selectOption({ label: reading });
  await dialog
    .getByRole('button', { name: 'Switch board', exact: true })
    .click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`${movies} now uses ${reading}`)).toBeVisible();
  await expect(page.getByText('Couldn’t switch the board')).toHaveCount(0);

  await expect
    .poll(
      async () => {
        const cols = await getInboxFolder<Collection>(
          rsUser,
          rsToken,
          'collections',
        );
        const id = (await serverSets(rsUser, rsToken)).find(
          (s) => s.name === reading,
        )?.id;
        return !!id && cols.find((c) => c.name === movies)?.boardSetId === id;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});
