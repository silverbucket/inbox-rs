/**
 * Cards added to a board column back to back all survive.
 *
 * Regression (#364): the add form cleared its field only once the card's
 * write settled. By then the next title was often already typed, so the late
 * clear wiped it and that Enter added nothing.
 *
 * This adds cards as fast as the form takes them on a throttled CPU, waiting
 * only for each to show, then checks the board, the server, and a reload all
 * hold every card.
 */

import { getInboxFolder, getInboxItems } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

test('cards added back to back to a board column are all kept', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  test.setTimeout(120_000);
  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${webOrigin}/#/collections`);

  await page
    .getByRole('button', { name: /New collection/ })
    .first()
    .click();
  await page.getByPlaceholder('e.g. Reading List').fill('Projects');
  await page.getByPlaceholder('e.g. Personal').fill('Work');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page
    .getByRole('button', { name: 'Focus on Projects' })
    .first()
    .click({ force: true });
  await page
    .getByRole('group', { name: 'View' })
    .getByRole('button', { name: 'Board', exact: true })
    .click();
  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  await page.getByRole('button', { name: 'Create board', exact: true }).click();

  // A slow device widens the gap between an add and its write settling.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });

  const unsorted = page.locator('section.column').first();
  await unsorted.getByRole('button', { name: /Add/ }).click();
  const input = page.getByLabel(/New card in/);
  const total = 24;
  for (let i = 1; i <= total; i++) {
    await input.fill(`Task ${i}`);
    await input.press('Enter');
    await expect(unsorted.locator('li.card')).toHaveCount(i);
  }
  await input.press('Escape');

  // Every card reaches the server, filed and listed in the collection.
  await expect
    .poll(
      async () => {
        const items = await getInboxItems(freshRsUser, freshRsToken);
        const [col] = await getInboxFolder<{ itemIds: string[] }>(
          freshRsUser,
          freshRsToken,
          'collections',
        );
        const ids = new Set(col?.itemIds ?? []);
        return {
          items: items.filter((i) => /^Task \d+$/.test(String(i.title))).length,
          listed: items.filter((i) => ids.has(String(i.id))).length,
        };
      },
      { timeout: 30_000 },
    )
    .toEqual({ items: total, listed: total });

  // The board still shows them all, now and after a reload.
  await expect(unsorted.locator('li.card')).toHaveCount(total);
  await page.reload();
  await expect(
    page.locator('section.column').first().locator('li.card'),
  ).toHaveCount(total);
});
