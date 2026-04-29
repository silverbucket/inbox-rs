/**
 * Mobile-specific layout: the 768 px breakpoint in App.svelte switches
 * the header from a single row into a 2-row CSS grid (brand + menu on
 * row 1, nav buttons centered on row 2).
 */

import { expect, test } from '../helpers/fixtures';

test('header uses grid layout on mobile', async ({ page, webOrigin }) => {
  // On phones, App.svelte's media query promotes `.header-inner` to
  // `display: grid` and pushes the nav onto its own row. Verify the
  // computed style so a future regression in the breakpoint is caught.
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  const display = await page.evaluate(() => {
    const el = document.querySelector('.header-inner');
    return el ? getComputedStyle(el).display : null;
  });
  expect(
    display,
    `.header-inner should be 'grid' on mobile, got ${display}`,
  ).toBe('grid');
});

test('brand logo shrinks on mobile', async ({ page, webOrigin }) => {
  // The brand logo drops from 38 px to 30 px under the mobile media
  // query. A regression here usually means a !important or specificity
  // bug.
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  const height = await page.evaluate(() => {
    const el = document.querySelector('.brand-logo');
    return el ? getComputedStyle(el).height : null;
  });
  expect(height, `.brand-logo should be 30px on mobile, got ${height}`).toBe(
    '30px',
  );
});

test('nav buttons remain visible at touch-target size', async ({
  page,
  webOrigin,
}) => {
  // Tab bars are notorious for getting clipped under the iOS home
  // indicator. Confirm the three primary nav buttons each occupy
  // non-zero box sizes inside the visible viewport.
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  for (const label of ['Inbox', 'Todos', 'Collections']) {
    const btn = page.getByRole('button', { name: label }).first();
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box, `${label} bounding box missing`).not.toBeNull();
    expect(
      box!.width,
      `${label} too narrow for a touch target: ${JSON.stringify(box)}`,
    ).toBeGreaterThan(40);
    expect(
      box!.height,
      `${label} too short for a touch target: ${JSON.stringify(box)}`,
    ).toBeGreaterThan(24);
  }
});
