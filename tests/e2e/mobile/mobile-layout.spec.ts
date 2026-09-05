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
      box?.width,
      `${label} too narrow for a touch target: ${JSON.stringify(box)}`,
    ).toBeGreaterThan(40);
    expect(
      box?.height,
      `${label} too short for a touch target: ${JSON.stringify(box)}`,
    ).toBeGreaterThan(24);
  }
});

for (const layout of ['sidebar', 'classic']) {
  test(`footer stacks its links under the identity line (${layout} layout)`, async ({
    page,
    webOrigin,
  }) => {
    // On a phone the footer is two flush-left rows: "Inbox RS · version ·
    // build date", then "Plugins · GitHub". The date must stay on one line —
    // it used to break after the time and leave "UTC" orphaned — and nothing
    // may push the page wider than the viewport.
    await page.addInitScript(
      (l) => localStorage.setItem('inbox-rs:layout', l),
      layout,
    );
    await page.goto(webOrigin);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );

    const box = async (selector: string, text?: string) => {
      const locator = text
        ? page.locator(selector, { hasText: text })
        : page.locator(selector);
      const b = await locator.boundingBox();
      if (!b) throw new Error(`${selector} must be laid out`);
      return b;
    };
    const brand = await box('.footer-brand');
    const version = await box('.footer-version');
    const plugins = await box('.footer-link', 'Plugins');
    const github = await box('.footer-link', 'GitHub');

    const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
    expect(
      Math.abs(centre(version) - centre(brand)),
      'version should sit beside the brand',
    ).toBeLessThanOrEqual(2);
    if ((await page.locator('.footer-date').count()) > 0) {
      const date = await box('.footer-date');
      expect(date.height, 'build date should not wrap').toBeLessThan(24);
      expect(
        Math.abs(centre(date) - centre(brand)),
        'build date should sit beside the brand',
      ).toBeLessThanOrEqual(2);
    }
    expect(
      plugins.y,
      'links should sit on their own row below the identity line',
    ).toBeGreaterThanOrEqual(brand.y + brand.height - 1);
    expect(
      Math.abs(plugins.x - brand.x),
      'links row should be flush left with the brand',
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(centre(github) - centre(plugins)),
      'both links should share a row',
    ).toBeLessThanOrEqual(2);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, 'footer must not widen the page').toBe(0);
  });
}
