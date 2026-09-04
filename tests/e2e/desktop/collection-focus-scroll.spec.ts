/**
 * Focused collections own vertical scrolling while the page behind stays put.
 *
 * The spacer represents enough cards to exceed the viewport without making
 * this regression depend on creating dozens of records through remoteStorage.
 * It lives inside the real CollectionView body, so the browser still exercises
 * the production flex/overflow chain that previously clipped tall collections.
 */

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from '../helpers/fixtures';
import {
  collectionsPageHeader,
  FIXTURE,
  seedSidebarFixture,
} from '../helpers/sidebar-drag';

const [ALPHA] = FIXTURE.collections;

let context: BrowserContext;
let page: Page;

test.beforeEach(async ({ browser, webOrigin }) => {
  test.setTimeout(90_000);
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(() =>
    localStorage.setItem('inbox-rs:layout', 'sidebar'),
  );
  page = await context.newPage();
  await seedSidebarFixture(page, webOrigin);
});

test.afterEach(async () => {
  await context?.close();
});

test('wheel scrolls a tall focused collection without moving the page behind it', async () => {
  await collectionsPageHeader(page, ALPHA)
    .getByRole('button', { name: `Focus on ${ALPHA}` })
    .click();

  const dialog = page.getByRole('dialog', { name: ALPHA });
  const scrollRegion = dialog.locator('.focus-scroll');
  await expect(scrollRegion).toBeVisible();

  await dialog.locator('.collection-body').evaluate((body) => {
    const spacer = document.createElement('div');
    spacer.dataset.testid = 'tall-collection-end';
    spacer.style.height = '1800px';
    spacer.textContent = 'Last collection card';
    body.append(spacer);
  });

  await expect
    .poll(() =>
      scrollRegion.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    )
    .toBeGreaterThan(1_000);

  const backgroundTop = await page
    .locator('main')
    .evaluate((element) => element.getBoundingClientRect().top);

  await scrollRegion.hover();
  await page.mouse.wheel(0, 1200);

  await expect
    .poll(() => scrollRegion.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(500);
  expect(
    await page
      .locator('main')
      .evaluate((element) => element.getBoundingClientRect().top),
  ).toBe(backgroundTop);
});
