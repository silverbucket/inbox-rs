/**
 * A board on a phone: the toolbar fits the screen (it used to push the
 * settings button off the right edge), and the column strip takes you to
 * a column that would otherwise be several swipes away.
 */

import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

test('the board toolbar fits a phone and the column strip jumps to a column', async ({
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

  await page
    .getByRole('button', { name: /New collection/ })
    .first()
    .click();
  await page.getByPlaceholder('e.g. Reading List').fill('Movies');
  await page.getByPlaceholder('e.g. Personal').fill('Home');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Actions for Movies' }).click();
  await page.getByRole('button', { name: 'Focus on Movies' }).click();
  await page
    .getByRole('group', { name: 'View' })
    .getByRole('button', { name: 'Board', exact: true })
    .click();
  await page.getByRole('button', { name: 'Watch list', exact: true }).click();
  await page.getByRole('button', { name: 'Create board', exact: true }).click();
  // The sheet covers the toolbar until it closes.
  await expect(page.getByRole('dialog', { name: 'New board' })).toHaveCount(0);
  await expect(
    page.locator('section.column').first(),
    'the board is showing',
  ).toBeVisible();

  // Every toolbar control is fully on screen and is what a tap there hits.
  const width = page.viewportSize()?.width ?? 0;
  for (const control of [
    page.getByRole('button', { name: 'Back', exact: true }),
    page
      .getByRole('group', { name: 'View' })
      .getByRole('button', { name: 'Board', exact: true }),
    page.getByRole('button', { name: 'Board settings' }).first(),
  ]) {
    const box = await control.boundingBox();
    if (!box) throw new Error('toolbar control not laid out');
    // Inside the panel's side padding, not merely on screen: a row that
    // is exactly full still looks broken, with a button on the very edge.
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
    const hit = await control.evaluate(
      (el, [x, y]) => {
        const at = document.elementFromPoint(x, y);
        return !!at && (el === at || el.contains(at));
      },
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(hit).toBe(true);
  }

  // The last column starts off screen; its chip brings it into view.
  const recommend = page.locator('section.column', {
    has: page.getByRole('heading', { name: 'Recommend', exact: true }),
  });
  await expect(recommend).not.toBeInViewport();
  await page
    .getByRole('navigation', { name: 'Jump to a column' })
    .getByRole('button', { name: /Recommend/ })
    .click();
  await expect(recommend).toBeInViewport({ ratio: 0.9 });
});
