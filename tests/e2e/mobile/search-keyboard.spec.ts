/**
 * Search on a phone, where the software keyboard covers the lower half of
 * the screen. Playwright has no keyboard to pop up, so these check the
 * things that keep results clear of it: the field rides at the very top
 * while it is being typed in, stays there as results scroll, and the
 * keyboard is put away (the field loses focus) once the user moves on to
 * the results.
 */

import type { InboxItem } from '@inbox-rs/rs-module';
import { putInboxItem } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';

const COUNT = 14;

async function openSearch(
  page: import('@playwright/test').Page,
  rsUser: string,
  rsToken: string,
  webOrigin: string,
) {
  for (let i = 0; i < COUNT; i++) {
    await putInboxItem(rsUser, rsToken, {
      item: {
        id: `kbd-search-${i}`,
        type: 'note',
        title: `Rhubarb recipe ${i}`,
        body: '',
        createdAt: new Date(Date.UTC(2026, 7, 1, 10, i)).toISOString(),
      } as InboxItem,
    });
  }
  // Start with the sidebar open, as it is on a first visit: on a phone it
  // stacks above the page.
  await page.addInitScript(() => {
    localStorage.setItem('inbox-rs:sidebar-collapsed', '0');
  });
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Rhubarb recipe 0')).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Search', exact: true }).tap();
  const box = page.getByRole('searchbox', { name: 'Search' });
  await expect(box).toBeVisible();
  return box;
}

test('results start near the top of the screen while typing', async ({
  connectedPage: page,
  rsUser,
  rsToken,
  webOrigin,
}) => {
  const box = await openSearch(page, rsUser, rsToken, webOrigin);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');

  // Arriving at search closes the sidebar, so the field is not pushed down.
  const before = await box.boundingBox();
  expect(before?.y ?? Infinity).toBeLessThan(viewport.height * 0.2);

  await box.tap();
  await box.fill('rhubarb');
  const cards = page.getByRole('region', { name: 'Matching cards' });
  const first = cards.locator('.result').first();
  await expect(first).toBeVisible();

  // The field sits flush with the top; the header has scrolled away.
  await expect
    .poll(async () => (await box.boundingBox())?.y ?? Infinity)
    .toBeLessThan(24);
  // A keyboard takes roughly the lower 40-45% of a phone screen. The first
  // result must begin well inside the part that stays visible.
  const firstBox = await first.boundingBox();
  expect(firstBox?.y ?? Infinity).toBeLessThan(viewport.height * 0.25);

  // The field is on top of whatever scrolls beneath it, not under it.
  const onTop = await box.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return hit === el;
  });
  expect(onTop).toBe(true);
});

test('the field stays in reach while results scroll', async ({
  connectedPage: page,
  rsUser,
  rsToken,
  webOrigin,
}) => {
  const box = await openSearch(page, rsUser, rsToken, webOrigin);
  await box.tap();
  await box.fill('rhubarb');
  await expect(
    page.getByText(`${COUNT} results`, { exact: false }),
  ).toBeVisible();

  await page.evaluate(() => window.scrollBy(0, 900));
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(600);
  const y = (await box.boundingBox())?.y ?? Infinity;
  expect(y).toBeGreaterThanOrEqual(0);
  expect(y).toBeLessThan(24);
});

test("the keyboard's Search key puts the keyboard away", async ({
  connectedPage: page,
  rsUser,
  rsToken,
  webOrigin,
}) => {
  const box = await openSearch(page, rsUser, rsToken, webOrigin);
  await box.tap();
  await box.fill('rhubarb');
  await expect(box).toBeFocused();
  await box.press('Enter');
  await expect(box).not.toBeFocused();
  // The query and its results are untouched.
  await expect(box).toHaveValue('rhubarb');
  await expect(page.getByText('Rhubarb recipe 3')).toBeVisible();
});

test('dragging the results puts the keyboard away', async ({
  connectedPage: page,
  rsUser,
  rsToken,
  webOrigin,
}) => {
  const box = await openSearch(page, rsUser, rsToken, webOrigin);
  await box.tap();
  await box.fill('rhubarb');
  const first = page
    .getByRole('region', { name: 'Matching cards' })
    .locator('.result')
    .first();
  await expect(first).toBeVisible();
  await expect(box).toBeFocused();

  await first.dispatchEvent('touchmove');
  await expect(box).not.toBeFocused();
});
