/**
 * The desktop sidebar hugs the header, then the viewport top.
 *
 * The header scrolls away with the page; the sidebar does not. Its top edge
 * must sit exactly on the header's bottom edge while any of the header is
 * still visible, and at the top of the viewport once it has gone. A fixed
 * header-sized offset gets the first state right and leaves a band of dead
 * space above the sidebar for the whole rest of the page.
 */

import type { Page } from '@playwright/test';

import { expect, test } from '../helpers/fixtures';

type Edges = { headerBottom: number; sidebarTop: number; scrollY: number };

function edges(page: Page): Promise<Edges> {
  return page.evaluate(() => {
    const header = document.querySelector('header');
    // The aside spans the whole page column; the box that sticks (and is
    // what the user sees as "the sidebar") is its scroll area.
    const sidebar = document.querySelector('.sidebar-scroll');
    if (!header || !sidebar) throw new Error('header and sidebar must render');
    return {
      headerBottom: header.getBoundingClientRect().bottom,
      sidebarTop: sidebar.getBoundingClientRect().top,
      scrollY: window.scrollY,
    };
  });
}

async function scrollTo(page: Page, y: number): Promise<void> {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);
}

/** Header-sized band above the sidebar, in px. Zero means no dead space. */
const gap = (e: Edges) => e.sidebarTop - Math.max(0, e.headerBottom);

for (const collapsed of [false, true]) {
  const state = collapsed ? 'collapsed' : 'expanded';
  test(`the ${state} sidebar sticks to the header, then to the viewport top`, async ({
    page,
    webOrigin,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem('inbox-rs:layout', 'sidebar'),
    );
    await page.goto(webOrigin);
    await page.waitForLoadState('networkidle');
    if (collapsed) {
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await expect(page.locator('.sidebar.collapsed')).toBeVisible();
    }
    await page.locator('main').evaluate((main) => {
      const spacer = document.createElement('div');
      spacer.style.height = '3000px';
      main.insertBefore(spacer, main.querySelector('.app-footer'));
    });

    const rest = await edges(page);
    expect(
      rest.headerBottom,
      'header should be visible at rest',
    ).toBeGreaterThan(40);
    expect(
      Math.abs(gap(rest)),
      'sidebar should start under the header',
    ).toBeLessThanOrEqual(1);

    // Part way through scrolling the header off: the sidebar follows its
    // edge. Read synchronously, not polled — the sidebar must move in the
    // same frame as the scroll, not catch up a frame later.
    await scrollTo(page, 30);
    const partial = await edges(page);
    expect(
      Math.abs(gap(partial)),
      'sidebar should hug the header mid-scroll',
    ).toBeLessThanOrEqual(1);
    expect(partial.headerBottom).toBeCloseTo(rest.headerBottom - 30, 0);
    expect(partial.sidebarTop).toBeCloseTo(partial.headerBottom, 0);

    // Header gone: the sidebar sits at the very top, no band above it.
    await scrollTo(page, 600);
    await expect
      .poll(async () => (await edges(page)).headerBottom)
      .toBeLessThanOrEqual(0);
    await expect
      .poll(async () => (await edges(page)).sidebarTop)
      .toBeLessThanOrEqual(1);
    expect((await edges(page)).sidebarTop).toBeGreaterThanOrEqual(0);

    // And back again.
    await scrollTo(page, 0);
    await expect
      .poll(async () => (await edges(page)).sidebarTop)
      .toBeCloseTo(rest.sidebarTop, 0);
  });
}
