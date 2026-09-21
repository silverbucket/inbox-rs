/**
 * Reordering todos by their grip.
 *
 * Regression: grabbing a todo and dragging it down the list made it vanish. The
 * row ended up in the right slot but stayed invisible — a permanent gap where
 * it should have landed — until something re-rendered the list.
 *
 * svelte-dnd-action finds the row it is carrying by *child index* in the zone.
 * The rows were wrapped in `out:fade`, and picking a row up briefly re-keys it,
 * so Svelte kept the outgoing copy in the DOM for the length of the fade. That
 * extra child shifted every index by one: the library hid a neighbour instead
 * of the carried row, and on drop un-hid the wrong element, leaving the real
 * one `visibility: hidden` for good.
 *
 * So these specs assert what a person sees — every row visible, in the new
 * order, with no stray copies — both mid-drag (button still down) and after
 * release. The persisted order alone was always correct; asserting only on
 * that is how this shipped.
 *
 * Every todo surface shares the gesture, so the collection view is covered as
 * well as the Todos page.
 */

import type { BrowserContext, Locator, Page } from '@playwright/test';

import { expect, test } from '../helpers/fixtures';
import {
  addTodo,
  dragGripPast,
  FIXTURE,
  gotoPage,
  seedSidebarFixture,
  todoRow,
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

/** The reorderable list: the one whose rows carry a grip. */
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

/**
 * A todo's row *inside the list*. While a drop animates, the library still has
 * the copy it was carrying (and the parked original) under `<body>`, so a
 * page-wide lookup would find three of the todo that was just dropped.
 */
function zoneRow(zone: Locator, title: string): Locator {
  return zone.locator('li.todo-row', {
    has: page.getByText(title, { exact: true }),
  });
}

/** How many of the zone's direct children are hidden from the user. */
function hiddenZoneChildren(zone: Locator): Promise<number> {
  return zone.evaluate(
    (ul) =>
      [...ul.children].filter(
        (child) => getComputedStyle(child).visibility === 'hidden',
      ).length,
  );
}

async function dragDownAndCheck(
  zone: Locator,
  titles: readonly string[],
): Promise<void> {
  // Let the rows' intro fades finish; a row still fading in is not the bug.
  await page.waitForTimeout(400);
  expect(await zoneTitles(zone)).toEqual(titles);

  const [carried, , landing] = titles;
  await dragGripPast(
    page,
    todoRow(page, carried).locator('.reorder-handle'),
    todoRow(page, landing),
    {
      whileHeld: async () => {
        // The copy under the cursor is the todo being carried…
        await expect(page.locator('#dnd-action-dragged-el')).toContainText(
          carried,
        );
        // …the list holds exactly one slot per todo, no leftover copies…
        await expect(zone.locator('li.todo-row')).toHaveCount(titles.length);
        // …and the only hidden slot is the gap the carried todo will fill.
        expect(await hiddenZoneChildren(zone)).toBe(1);
        for (const title of titles.filter((t) => t !== carried))
          await expect(zoneRow(zone, title)).toBeVisible();
      },
    },
  );

  const reordered = [titles[1], titles[2], carried, ...titles.slice(3)];
  await expect.poll(() => zoneTitles(zone)).toEqual(reordered);
  // The heart of the regression: the dropped todo shows up where it landed.
  await expect(zoneRow(zone, carried)).toBeVisible();
  await expect.poll(() => hiddenZoneChildren(zone)).toBe(0);
  for (const title of titles) await expect(zoneRow(zone, title)).toBeVisible();
}

test('a todo dragged down the Todos page shows up where it is dropped', async ({
  webOrigin,
}) => {
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');
  await gotoPage(page, /^Todos/);

  // Newest first, so the list reads Delta, Charlie, Bravo, Alfa.
  for (const title of ['Alfa', 'Bravo', 'Charlie', 'Delta'])
    await addTodo(page, `Reorder ${title}`);

  await dragDownAndCheck(reorderZone(page), [
    'Reorder Delta',
    'Reorder Charlie',
    'Reorder Bravo',
    'Reorder Alfa',
  ]);
});

test('a todo dragged down a collection shows up where it is dropped', async ({
  webOrigin,
}) => {
  await context.addInitScript(() =>
    localStorage.setItem('inbox-rs:layout', 'sidebar'),
  );
  // Leaves the first collection expanded on the Collections page with one
  // todo already filed in it; the quick-add there files the rest below it.
  await seedSidebarFixture(page, webOrigin);
  for (const title of ['Bravo', 'Charlie', 'Delta'])
    await addTodo(page, `Reorder ${title}`);

  await dragDownAndCheck(reorderZone(page.locator('main')), [
    FIXTURE.filedTodo,
    'Reorder Bravo',
    'Reorder Charlie',
    'Reorder Delta',
  ]);
});
