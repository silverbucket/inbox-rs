/**
 * Reordering a list of exactly two todos.
 *
 * Reported: "I have two todos, I try to drag one above the other and it just
 * snaps back to where they were." The four-row specs in
 * `todo-reorder-drag.spec.ts` kept passing, so the list length matters.
 *
 * With two rows a person drags the bottom one up until it sits *above* the
 * other, which carries the pointer past the top row's middle — and, because
 * the list is only two rows tall, often clean out of the list's box. The
 * swap has to stick in both cases: on release, and after a reload.
 */

import type { BrowserContext, Locator, Page } from '@playwright/test';

import { expect, test } from '../helpers/fixtures';
import {
  addTodo,
  dragGripPast,
  FIXTURE,
  gotoPage,
  seedSidebarFixture,
} from '../helpers/sidebar-drag';

let context: BrowserContext;
let page: Page;

test.beforeEach(async ({ browser }) => {
  test.setTimeout(90_000);
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  page = await context.newPage();
});

test.afterEach(async () => {
  await context?.close();
});

function reorderZone(scope: Page | Locator): Locator {
  return scope
    .locator('ul.todo-list', { has: page.locator('.reorder-handle') })
    .first();
}

function zoneTitles(zone: Locator): Promise<string[]> {
  return zone
    .locator('li.todo-row .title')
    .evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));
}

function zoneRow(zone: Locator, title: string): Locator {
  return zone.locator('li.todo-row', {
    has: page.getByText(title, { exact: true }),
  });
}

/** Where the pointer lets go, relative to the top row. */
const releases = [
  { name: 'on the middle of the top row', overshootPx: 0 },
  { name: 'at the top edge of the top row', overshootPx: -6 },
  { name: 'just above the list', overshootPx: 12 },
] as const;

for (const surface of ['Todos', 'collection'] as const) {
  for (const release of releases) {
    test(`with two todos in ${surface}, dragging the lower one above the upper swaps them — released ${release.name}`, async ({
      webOrigin,
    }) => {
      let titles: [string, string];
      if (surface === 'Todos') {
        await page.goto(webOrigin);
        await page.waitForLoadState('networkidle');
        await gotoPage(page, /^Todos/);
        for (const title of ['Alfa', 'Bravo'])
          await addTodo(page, `Pair ${title}`);
        // Newest first.
        titles = ['Pair Bravo', 'Pair Alfa'];
      } else {
        await context.addInitScript(() =>
          localStorage.setItem('inbox-rs:layout', 'sidebar'),
        );
        await seedSidebarFixture(page, webOrigin);
        await addTodo(page, 'Pair Bravo');
        titles = [FIXTURE.filedTodo, 'Pair Bravo'];
      }
      const zone = reorderZone(page.locator('main'));
      await expect.poll(() => zoneTitles(zone)).toEqual(titles);
      await page.waitForTimeout(400);

      const [upper, lower] = titles;
      await dragGripPast(
        page,
        zoneRow(zone, lower).locator('.reorder-handle'),
        zoneRow(zone, upper),
        {
          overshootAbovePx: release.overshootPx,
          whileHeld: async () => {
            await expect(page.locator('#dnd-action-dragged-el')).toContainText(
              lower,
            );
          },
        },
      );
      await expect(page.locator('#dnd-action-dragged-el')).toHaveCount(0);

      await expect.poll(() => zoneTitles(zone)).toEqual([lower, upper]);
      for (const title of titles)
        await expect(zoneRow(zone, title)).toBeVisible();

      await page.reload();
      await expect
        .poll(() => zoneTitles(reorderZone(page.locator('main'))))
        .toEqual([lower, upper]);
    });
  }
}
