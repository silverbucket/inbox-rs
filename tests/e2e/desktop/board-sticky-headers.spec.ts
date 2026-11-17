/**
 * Board column headers stay in view while a long column scrolls.
 *
 * Regression: the board grew as tall as its longest column and the page
 * around it scrolled, so at the bottom of a long column every column's
 * header was off screen. A card dragged from down there could still be
 * dropped (the target column lit up), but nothing said which column was
 * which.
 *
 * The board now scrolls inside itself and each header sticks to its top.
 * This scrolls to the bottom card of a long column, drags it sideways, and
 * hit-tests the headers mid-drag, in a collection's board and in the group
 * board.
 */

import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

const columnNamed = (page: Page, name: string) =>
  page.locator('section.column', {
    has: page.getByRole('heading', { name, exact: true }),
  });

/** The header is on screen and is what a pointer at its centre touches. */
async function headerShowing(column: Locator): Promise<boolean> {
  return column.locator('.col-head').evaluate((head) => {
    const box = head.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) return false;
    const at = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return !!at && head.contains(at);
  });
}

test('column headers stay in view at the bottom of a long column', async ({
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
  await page.setViewportSize({ width: 1440, height: 700 });
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
  await page
    .getByRole('group', { name: 'View' })
    .getByRole('button', { name: 'Board', exact: true })
    .click();
  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  await page.getByRole('button', { name: 'Create board', exact: true }).click();

  const unsorted = page.locator('section.column').first();
  const idea = columnNamed(page, 'Idea');
  await expect(idea).toBeVisible();

  // Fill Unsorted well past the viewport.
  await unsorted.getByRole('button', { name: /Add/ }).click();
  const input = page.getByLabel(/New card in/);
  const total = 16;
  for (let i = 1; i <= total; i++) {
    await input.fill(`Task ${i}`);
    await input.press('Enter');
    await expect(unsorted.locator('li.card')).toHaveCount(i);
    // The form clears once the card is stored; typing before that is wiped.
    await expect(input).toHaveValue('');
  }
  await input.press('Escape');

  // At the bottom card, both the long column's header and a short one's
  // are still showing.
  const last = unsorted.locator('li.card').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 0.95 });
  await expect(unsorted.locator('li.card').first()).not.toBeInViewport();
  expect(await headerShowing(unsorted), 'long column header').toBe(true);
  expect(await headerShowing(idea), 'short column header').toBe(true);

  // Drag the bottom card across: the target's header shows while it is held.
  const from = await last.boundingBox();
  const ideaBox = await idea.boundingBox();
  if (!from || !ideaBox) throw new Error('board not laid out');
  const y = from.y + from.height / 2;
  const x = ideaBox.x + ideaBox.width / 2;
  await page.mouse.move(from.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, y, { steps: 5 });
  await page.mouse.move(x, y, { steps: 15 });
  await expect(idea).toHaveClass(/\bover\b/);
  expect(await headerShowing(idea), 'target header mid-drag').toBe(true);
  await page.mouse.up();
  await expect(idea.locator('li.card')).toContainText(`Task ${total}`);
  await expect(unsorted.locator('li.card')).toHaveCount(total - 1);

  // In a window too short for the board's minimum height, the page around it
  // scrolls as well: the bottom card and the note under the board are both
  // still reachable.
  const note = page.getByText('Drag a card to another column to move it.');
  await page.setViewportSize({ width: 1440, height: 380 });
  const bottom = unsorted.locator('li.card').last();
  await bottom.scrollIntoViewIfNeeded();
  await expect(bottom).toBeInViewport({ ratio: 0.95 });
  expect(await headerShowing(unsorted), 'short window header').toBe(true);
  await note.scrollIntoViewIfNeeded();
  await expect(note).toBeInViewport({ ratio: 0.95 });
  await page.setViewportSize({ width: 1440, height: 700 });

  // The group board shows the same columns and keeps its headers too.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByTitle('Open Work as one board').click();
  const group = page.getByRole('dialog', { name: 'Work board' });
  const groupUnsorted = group.locator('section.column').first();
  const groupIdea = group.locator('section.column', {
    has: page.getByRole('heading', { name: 'Idea', exact: true }),
  });
  await expect(groupUnsorted.locator('li.card')).toHaveCount(total - 1);
  const groupLast = groupUnsorted.locator('li.card').last();
  await groupLast.scrollIntoViewIfNeeded();
  await expect(groupLast).toBeInViewport({ ratio: 0.95 });
  expect(await headerShowing(groupUnsorted), 'group: long header').toBe(true);
  expect(await headerShowing(groupIdea), 'group: short header').toBe(true);
});
