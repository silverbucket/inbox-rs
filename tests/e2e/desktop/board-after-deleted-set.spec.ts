/**
 * A collection can be left pointing at a board that no longer exists — the
 * set was deleted on another device, say. Setting up a new board for it
 * must simply work: no "switch to a different board" step for a board that isn't
 * there, and the collection ends up on the new set on the server.
 *
 * Runs on its own fresh account: it rewrites the config on the server
 * behind the app's back, which must not leak into the shared one.
 */

import type { Collection } from '@inbox-rs/rs-module';
import {
  ARMADIETTO_ORIGIN,
  getInboxFolder,
  type RsUser,
} from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

const configUrl = (user: RsUser) =>
  `${ARMADIETTO_ORIGIN}/storage/${user.username}/inbox/config/app`;

async function serverConfig(user: RsUser, token: string) {
  const r = await fetch(configUrl(user), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.ok
    ? ((await r.json()) as {
        columnSets?: Array<{ id: string; name: string }>;
        collectionViews?: Record<string, string>;
      })
    : {};
}

test('a collection whose board was deleted elsewhere gets a new board in one step', async ({
  context,
  webOrigin,
  freshRsUser: rsUser,
  freshRsToken: rsToken,
}) => {
  await seedRsSession(context, rsUser, rsToken, { clientOrigin: webOrigin });
  const page = await context.newPage();
  const stamp = Date.now();
  const movies = `Movies ${stamp}`;
  const oldSet = `Old board ${stamp}`;
  const newSet = `Watch list ${stamp}`;

  await page.goto(`${webOrigin}/#/collections`);
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'New collection' }).first().click();
  await page.getByPlaceholder('e.g. Reading List').fill(movies);
  const newGroup = page.getByPlaceholder('e.g. Personal');
  if (await newGroup.isVisible()) await newGroup.fill(`Home ${stamp}`);
  await page.keyboard.press('Enter');

  const openBoard = async () => {
    await page.getByRole('button', { name: `Focus on ${movies}` }).click();
    await page
      .getByRole('group', { name: 'View' })
      .getByRole('button', { name: 'Board', exact: true })
      .click();
  };

  // Give it a board, then delete that set the way another device would:
  // straight on the server, leaving the collection pointing at nothing.
  await openBoard();
  await page.getByRole('button', { name: 'Blank', exact: true }).click();
  await page.locator('#set-name').fill(oldSet);
  await page.getByRole('button', { name: 'Create board', exact: true }).click();
  await expect
    .poll(
      async () => {
        // Both of the setup's config writes must have landed (the set, then
        // the collection's Board view): deleting the set while the second
        // is still on its way would let that write put the set back.
        const config = await serverConfig(rsUser, rsToken);
        return (
          !!config.columnSets?.some((s) => s.name === oldSet) &&
          Object.values(config.collectionViews ?? {}).includes('board')
        );
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  const config = await serverConfig(rsUser, rsToken);
  const put = await fetch(configUrl(rsUser), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${rsToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...config,
      columnSets: config.columnSets?.filter((s) => s.name !== oldSet),
    }),
  });
  expect(put.ok).toBe(true);
  await page.goto(`${webOrigin}/#/collections`);
  await page.reload();
  await page.waitForLoadState('networkidle');

  // Setting up a board again goes straight to the board.
  await openBoard();
  await page.getByRole('button', { name: 'Watch list', exact: true }).click();
  await page.locator('#set-name').fill(newSet);
  await page.getByRole('button', { name: 'Create board', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Switch to a different board' }),
  ).toHaveCount(0);
  await expect(page.getByText('Want to watch', { exact: true })).toBeVisible();

  await expect
    .poll(
      async () => {
        const cols = await getInboxFolder<Collection>(
          rsUser,
          rsToken,
          'collections',
        );
        const sets = (await serverConfig(rsUser, rsToken)).columnSets ?? [];
        const id = sets.find((s) => s.name === newSet)?.id;
        return !!id && cols.find((c) => c.name === movies)?.boardSetId === id;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});
