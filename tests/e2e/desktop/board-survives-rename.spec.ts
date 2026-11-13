/**
 * A collection's board belongs to the collection, not its name: renaming
 * the collection keeps its column set, and the set stays on offer for other
 * collections. Asserted on the server too, since a board that only survives
 * in this browser's cache is gone on the next device.
 */

import type { Collection } from '@inbox-rs/rs-module';
import {
  ARMADIETTO_ORIGIN,
  getInboxFolder,
  type RsUser,
} from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';

async function serverConfig(user: RsUser, token: string) {
  const r = await fetch(
    `${ARMADIETTO_ORIGIN}/storage/${user.username}/inbox/config/app`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return r.ok
    ? ((await r.json()) as {
        columnSets?: Array<{ id: string; name: string }>;
        collectionViews?: Record<string, string>;
      })
    : {};
}

test('renaming a collection keeps its board and column set', async ({
  connectedPage,
  webOrigin,
  rsUser,
  rsToken,
}) => {
  const page = connectedPage;
  const stamp = Date.now();
  const before = `Fiddle ${stamp}`;
  const after = `Fiddle Practice ${stamp}`;
  const setName = `Practice stages ${stamp}`;

  await page.goto(`${webOrigin}/#/collections`);
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'New collection' }).first().click();
  await page.getByPlaceholder('e.g. Reading List').fill(before);
  const newGroup = page.getByPlaceholder('e.g. Personal');
  if (await newGroup.isVisible()) await newGroup.fill(`Music ${stamp}`);
  await page.keyboard.press('Enter');

  // Set up a board with the user's own column names.
  await page.getByRole('button', { name: `Focus on ${before}` }).click();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await page.getByRole('button', { name: 'New column set…' }).click();
  // A name typed first survives picking a different starting point.
  await page.locator('#set-name').fill(setName);
  await page.getByRole('button', { name: 'Blank', exact: true }).click();
  await expect(page.locator('#set-name')).toHaveValue(setName);
  const firstColumn = page
    .getByRole('textbox', { name: 'Column name' })
    .first();
  await firstColumn.fill('Learning');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('Learning', { exact: true })).toBeVisible();

  // Rename straight away, as a user would.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Edit collection' }).first().click();
  await page.getByPlaceholder('e.g. Reading List').fill(after);
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: `Focus on ${after}` }),
  ).toBeVisible();

  // The server holds the renamed collection, still on its set, and the set.
  await expect
    .poll(
      async () => {
        const cols = await getInboxFolder<Collection>(
          rsUser,
          rsToken,
          'collections',
        );
        const col = cols.find((c) => c.name === after);
        const config = await serverConfig(rsUser, rsToken);
        const set = config.columnSets?.find((s) => s.name === setName);
        return {
          renamed: !!col,
          onSet: !!set && col?.boardSetId === set.id,
        };
      },
      { timeout: 20_000 },
    )
    .toEqual({ renamed: true, onSet: true });

  // And a fresh load (server truth) still opens it as that board.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: `Focus on ${after}` }).click();
  await expect(page.getByText('Learning', { exact: true })).toBeVisible();
  await expect(page.getByText(setName).first()).toBeVisible();
});
