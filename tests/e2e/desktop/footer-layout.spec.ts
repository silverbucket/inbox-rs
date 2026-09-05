/**
 * The footer must stay readable in the sidebar layout.
 *
 * The desktop sidebar has been rebuilt more than once (plain grid item,
 * sticky, fixed) and each rebuild has found a new way to paint over the
 * footer's left end. That end is exposed by design: the footer bleeds under
 * the sidebar column so its rule spans the whole page, which puts the
 * "Inbox RS" brand and the version label exactly where the sidebar is.
 *
 * These specs assert what the user sees rather than how the CSS gets there:
 * hit-test the footer at the points a user would read or click, in every
 * sidebar state, on both short and long pages.
 */

import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../helpers/fixtures';

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(target: Locator, what: string): Promise<Box> {
  const box = await target.boundingBox();
  if (!box) throw new Error(`${what} must be laid out`);
  return box;
}

/** What the browser would deliver a click to at the centre of `target`. */
async function elementAtCentre(
  page: Page,
  target: Locator,
): Promise<{ inFooter: boolean; inSidebar: boolean; hit: string }> {
  await target.scrollIntoViewIfNeeded();
  const box = await boxOf(target, 'target');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  return page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      const label = el
        ? `<${el.tagName.toLowerCase()} class="${el.className}">`
        : 'nothing';
      return {
        inFooter: Boolean(el?.closest('.app-footer')),
        inSidebar: Boolean(el?.closest('.sidebar')),
        hit: label,
      };
    },
    [x, y] as const,
  );
}

/**
 * Every part of the footer a user reads or clicks must be the topmost thing
 * at its own position, and the bar must still run edge to edge.
 */
async function expectFooterReadable(page: Page): Promise<void> {
  const targets: Array<[string, Locator]> = [
    ['brand', page.locator('.footer-brand')],
    ['version', page.locator('.footer-version')],
    ['Plugins link', page.locator('.footer-link', { hasText: 'Plugins' })],
    ['GitHub link', page.locator('.footer-link', { hasText: 'GitHub' })],
  ];
  for (const [name, target] of targets) {
    await expect(target).toBeVisible();
    const result = await elementAtCentre(page, target);
    expect(result.inFooter, `footer ${name} is covered by ${result.hit}`).toBe(
      true,
    );
  }

  // The bar deliberately spans the sidebar column too (one rule across the
  // whole page). A "fix" that just retreats the footer into the content
  // column would hide the bug rather than solve it, so pin the full width.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('viewport must be set for this test');
  const bar = await boxOf(page.locator('.app-footer-inner'), 'footer bar');
  expect(bar.x, 'footer bar should start at the page edge').toBeLessThanOrEqual(
    1,
  );
  expect(
    bar.x + bar.width,
    'footer bar should reach the far page edge',
  ).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(
    bar.y + bar.height,
    'footer bar should sit inside the viewport',
  ).toBeLessThanOrEqual(viewport.height + 1);
}

/**
 * On desktop the bar is one line: identity (brand, version, build date) on
 * the left, links on the right. The two-line stack it replaced pushed the
 * separator dot to mid-air and doubled the bar's height.
 */
async function expectSingleRowFooter(page: Page): Promise<void> {
  const centres: number[] = [];
  for (const target of [
    page.locator('.footer-brand'),
    page.locator('.footer-version'),
    page.locator('.footer-date'),
    page.locator('.footer-link', { hasText: 'Plugins' }),
    page.locator('.footer-link', { hasText: 'GitHub' }),
  ]) {
    // The build date is only stamped by a real `vite build`.
    if ((await target.count()) === 0) continue;
    const box = await boxOf(target, 'footer item');
    centres.push(box.y + box.height / 2);
  }
  const spread = Math.max(...centres) - Math.min(...centres);
  expect(spread, 'footer items should share one row').toBeLessThanOrEqual(2);

  const bar = await boxOf(page.locator('.app-footer-inner'), 'footer bar');
  expect(bar.height, 'footer bar should be one line tall').toBeLessThan(60);
}

/**
 * Pad `main` with enough content that the footer lands well below the fold,
 * without depending on dozens of real records. The spacer goes above the
 * footer so the footer keeps its production position at the end of `main`.
 */
async function makePageTall(page: Page): Promise<void> {
  await page.locator('main').evaluate((main) => {
    const spacer = document.createElement('div');
    spacer.dataset.testid = 'tall-page-spacer';
    spacer.style.height = '3000px';
    spacer.textContent = 'Lots of content';
    main.insertBefore(spacer, main.querySelector('.app-footer'));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollHeight -
          document.documentElement.clientHeight,
      ),
    )
    .toBeGreaterThan(2_000);
}

async function scrollPageToBottom(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollHeight -
          document.documentElement.clientHeight -
          window.scrollY,
      ),
    )
    .toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page, webOrigin }) => {
  await page.addInitScript(() =>
    localStorage.setItem('inbox-rs:layout', 'sidebar'),
  );
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.sidebar')).toBeVisible();
});

test('footer is readable on a short page with the sidebar expanded', async ({
  page,
}) => {
  // The disconnected inbox fits in the viewport, so the footer is pinned to
  // the bottom of `main` with no scrolling involved.
  await expectFooterReadable(page);
});

test('footer is readable at the bottom of a long page', async ({ page }) => {
  await makePageTall(page);
  await scrollPageToBottom(page);
  await expectFooterReadable(page);
});

test('footer is readable with the sidebar collapsed to a rail', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.locator('.sidebar.collapsed')).toBeVisible();

  await expectFooterReadable(page);

  await makePageTall(page);
  await scrollPageToBottom(page);
  await expectFooterReadable(page);
});

test('last sidebar row stays reachable when the page is scrolled to the footer', async ({
  page,
}) => {
  // The other half of the bargain: whatever keeps the footer on top must not
  // make the bottom of an overflowing sidebar unreachable. Overflow the
  // sidebar, scroll both it and the page to their ends, and the last row must
  // still be the thing under the pointer.
  await page.locator('.sidebar').evaluate((sidebar) => {
    const spacer = document.createElement('div');
    spacer.style.height = '2000px';
    sidebar.append(spacer);
    const marker = document.createElement('div');
    marker.dataset.testid = 'last-sidebar-row';
    marker.style.height = '24px';
    marker.textContent = 'Last group';
    sidebar.append(marker);
  });
  await makePageTall(page);
  await scrollPageToBottom(page);
  await page
    .locator('.sidebar')
    .evaluate((sidebar) => sidebar.scrollTo(0, sidebar.scrollHeight));

  const result = await elementAtCentre(
    page,
    page.getByTestId('last-sidebar-row'),
  );
  expect(result.inSidebar, `last sidebar row is covered by ${result.hit}`).toBe(
    true,
  );
  await expectFooterReadable(page);
});

test('footer keeps identity and links on one row', async ({ page }) => {
  await expectSingleRowFooter(page);
  await makePageTall(page);
  await scrollPageToBottom(page);
  await expectSingleRowFooter(page);
});

test('classic layout gets the same one-row, full-width footer', async ({
  page,
  webOrigin,
}) => {
  // Both shells render the same AppFooter; this guards the classic shell's
  // wrapper, which has drifted from the sidebar shell's before.
  await page.addInitScript(() =>
    localStorage.setItem('inbox-rs:layout', 'classic'),
  );
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.sidebar')).toHaveCount(0);

  await expectFooterReadable(page);
  await expectSingleRowFooter(page);
});
