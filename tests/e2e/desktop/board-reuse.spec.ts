/**
 * A board you set up for one collection is on offer for the next: the
 * picker lists it under "Your boards" with who uses it, and makes the
 * choice between sharing its columns and taking a separate copy explicit.
 * Asserted on the server too — which set a collection points at is what
 * the next device sees.
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

test('a board made for one collection can be shared with or copied to another', async ({
  connectedPage,
  webOrigin,
  rsUser,
  rsToken,
}) => {
  const page = connectedPage;
  const stamp = Date.now();
  const guitar = `Guitar ${stamp}`;
  const piano = `Piano ${stamp}`;
  const drums = `Drums ${stamp}`;
  const setName = `Practice ${stamp}`;

  await page.goto(`${webOrigin}/#/collections`);
  await page.waitForLoadState('networkidle');

  async function newCollection(name: string) {
    await page.getByRole('button', { name: 'New collection' }).first().click();
    await page.getByPlaceholder('e.g. Reading List').fill(name);
    const newGroup = page.getByPlaceholder('e.g. Personal');
    if (await newGroup.isVisible()) await newGroup.fill(`Music ${stamp}`);
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: `Focus on ${name}` }),
    ).toBeVisible();
  }
  async function openBoardPicker(name: string) {
    await page.getByRole('button', { name: `Focus on ${name}` }).click();
    await page
      .getByRole('group', { name: 'View' })
      .getByRole('button', { name: 'Board', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Set up a board' }),
    ).toBeVisible();
  }
  const back = () =>
    page.getByRole('button', { name: 'Back', exact: true }).click();

  await newCollection(guitar);
  await newCollection(piano);
  await newCollection(drums);

  // Guitar: a board of the user's own, from Blank.
  await openBoardPicker(guitar);
  await page.getByRole('button', { name: 'Blank', exact: true }).click();
  await page.locator('#set-name').fill(setName);
  await page
    .getByRole('textbox', { name: 'Column name' })
    .first()
    .fill('Practising');
  await page.getByRole('button', { name: 'Create board', exact: true }).click();
  // Saving says the board is reusable.
  await expect(
    page.getByText(
      `Created the ${setName} board. Other collections can use it too.`,
    ),
  ).toBeVisible();
  await expect(page.getByText('Practising', { exact: true })).toBeVisible();
  await back();

  // Piano: the picker offers it by name, with who uses it — and uses it too.
  await openBoardPicker(piano);
  const picker = page.getByRole('dialog', { name: 'Set up a board' });
  await expect(picker.getByText(`used by ${guitar}`)).toBeVisible();
  await picker.getByRole('button', { name: `Use ${setName}` }).click();
  await expect(page.getByText('Practising', { exact: true })).toBeVisible();
  await back();

  // Drums: Copy opens the new-board dialog on that board, as a separate set.
  await openBoardPicker(drums);
  await page.getByRole('button', { name: `Copy ${setName}` }).click();
  const dialog = page.getByRole('dialog', { name: 'New board' });
  await expect(dialog.getByText(`A copy of ${setName}`)).toBeVisible();
  await expect(page.locator('#set-name')).toHaveValue(`${setName} copy`);
  await expect(dialog.getByText(`A separate copy of ${setName}`)).toBeVisible();
  await expect(
    dialog.getByRole('textbox', { name: 'Column name' }).first(),
  ).toHaveValue('Practising');
  await dialog
    .getByRole('button', { name: 'Create board', exact: true })
    .click();
  await expect(page.getByText('Practising', { exact: true })).toBeVisible();

  // Server truth: Guitar and Piano on one set, Drums on its own copy.
  await expect
    .poll(
      async () => {
        const cols = await getInboxFolder<Collection>(
          rsUser,
          rsToken,
          'collections',
        );
        const sets = await serverSets(rsUser, rsToken);
        const idOf = (name: string) => sets.find((s) => s.name === name)?.id;
        const setOf = (name: string) =>
          cols.find((c) => c.name === name)?.boardSetId;
        const original = idOf(setName);
        const copy = idOf(`${setName} copy`);
        return {
          sets: !!original && !!copy && original !== copy,
          guitar: setOf(guitar) === original,
          piano: setOf(piano) === original,
          drums: setOf(drums) === copy,
        };
      },
      { timeout: 20_000 },
    )
    .toEqual({ sets: true, guitar: true, piano: true, drums: true });
});
