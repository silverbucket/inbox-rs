/**
 * Board columns accept a drop at any height.
 *
 * Regression: each column was only as tall as its own cards. With a long
 * column beside short ones, a card dragged from the bottom of the long column
 * had nothing to land on: the short columns had scrolled out of view above,
 * so the card had to be carried back up to their last card.
 *
 * Columns now stretch to the tallest one. This drags the bottom card of a long
 * column sideways, at the same height, into an empty column, and asserts the
 * cue mid-drag (the column is highlighted) and the move after release.
 */

import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

test('a card from the bottom of a long column drops into a short one beside it', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  test.setTimeout(90_000);
  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${webOrigin}/#/collections`);

  // A collection laid out on the Pipeline template's columns.
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
  await page.getByRole('button', { name: /Columns/ }).click();
  await page.getByRole('button', { name: 'New column set…' }).click();
  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  await page.locator('.bx-primary').last().click();
  const done = page.getByRole('button', { name: 'Done', exact: true });
  if (await done.isVisible()) await done.click();

  const columns = page.locator('section.column');
  const unsorted = columns.first();
  const idea = columns.nth(1);
  await expect(idea).toBeVisible();

  // Fill Unsorted well past the viewport. Let each add finish syncing first:
  // back-to-back adds race on the collection document and can drop a card.
  await unsorted.getByRole('button', { name: /Add/ }).click();
  const input = page.getByLabel(/New card in/);
  const total = 24;
  for (let i = 1; i <= total; i++) {
    await input.fill(`Task ${i}`);
    await input.press('Enter');
    await expect(unsorted.locator('li.card')).toHaveCount(i);
    await page.waitForLoadState('networkidle');
  }
  await input.press('Escape');

  // Scroll to the bottom card and drag it straight across.
  const last = unsorted.locator('li.card').last();
  await last.scrollIntoViewIfNeeded();
  const from = await last.boundingBox();
  const ideaBox = await idea.boundingBox();
  if (!from || !ideaBox) throw new Error('board not laid out');
  const y = from.y + from.height / 2;
  const x = ideaBox.x + ideaBox.width / 2;

  // The short column reaches down to the dragged card's height...
  const hit = await page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest('section.column')
        ?.querySelector('h3')?.textContent,
    { x, y },
  );
  expect(hit).toBe('Idea');

  await page.mouse.move(from.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, y, { steps: 5 });
  await page.mouse.move(x, y, { steps: 15 });

  // ...and takes the drop there: highlighted mid-drag, holding the card after.
  await expect(idea).toHaveClass(/\bover\b/);
  await page.mouse.up();
  await expect(idea.locator('li.card')).toHaveCount(1);
  await expect(idea.locator('li.card')).toContainText(`Task ${total}`);
  await expect(unsorted.locator('li.card')).toHaveCount(total - 1);
});
