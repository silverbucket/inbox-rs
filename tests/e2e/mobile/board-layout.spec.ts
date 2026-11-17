/**
 * A board on a phone: the toolbar fits the screen (it used to push the
 * settings button off the right edge), and the column strip takes you to
 * a column that would otherwise be several swipes away.
 */

import type { Locator } from '@playwright/test';
import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

/**
 * A finger lands a little off a small button. 6px above its visible edge
 * must still hit it: the toolbar buttons keep their look but take a 44px
 * tap through an invisible area around them.
 */
async function hitsJustOutside(control: Locator): Promise<boolean> {
  const box = await control.boundingBox();
  if (!box) throw new Error('toolbar control not laid out');
  return control.evaluate(
    (el, [x, y]) => {
      const at = document.elementFromPoint(x, y);
      return !!at && (el === at || el.contains(at));
    },
    [box.x + box.width / 2, box.y - 6],
  );
}

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

  // Both small toolbar buttons take a finger-sized tap, and a tap just
  // outside Back still leaves the board.
  const back = page.getByRole('button', { name: 'Back', exact: true });
  expect(await hitsJustOutside(back), 'Back takes a 44px tap').toBe(true);
  expect(
    await hitsJustOutside(
      page.getByRole('button', { name: 'Board settings' }).first(),
    ),
    'Board settings takes a 44px tap',
  ).toBe(true);
  const backBox = await back.boundingBox();
  if (!backBox) throw new Error('Back not laid out');
  await page.touchscreen.tap(backBox.x + backBox.width / 2, backBox.y - 6);
  await expect(page.locator('section.column')).toHaveCount(0);

  // A group's board uses the same arrow-only Back, and its toolbar fits.
  await page.goto(`${webOrigin}/#/collections`);
  await page.locator('.btn-board').first().click();
  const groupBack = page.getByRole('button', { name: 'Back', exact: true });
  await expect(groupBack).toBeVisible();
  await expect(groupBack.locator('.back-label')).toBeHidden();
  const groupBox = await groupBack.boundingBox();
  if (!groupBox) throw new Error('group board Back not laid out');
  expect(groupBox.x).toBeGreaterThanOrEqual(8);
  expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(width - 8);
  expect(groupBox.height, 'arrow-only Back, one line').toBeLessThan(44);
  expect(
    await hitsJustOutside(groupBack),
    'group board Back takes a 44px tap',
  ).toBe(true);
});
