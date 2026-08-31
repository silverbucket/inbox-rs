/**
 * Dragging things onto, and within, the sidebar.
 *
 * Two separate gestures share this UI and have repeatedly broken each other:
 *
 * 1. **Filing** — a native HTML5 drag of an inbox card or a todo row onto a
 *    sidebar collection, which moves the item into that collection.
 * 2. **Reordering** — a pointer drag of a svelte-dnd-action grip, which
 *    reorders the sidebar's groups and collections.
 *
 * The filing drag kept dying because svelte-dnd-action puts
 * `ondragstart = () => false` on every direct child of a drop zone (see
 * `styleDraggable` in the library). Cards and todo rows are nested inside
 * those zones on the todos and collections pages, so a bubbling `dragstart`
 * reached that handler and cancelled the drag before it started. Unit tests
 * that inspect the drag payload cannot see this: the payload is set correctly
 * and the drag is aborted immediately afterwards.
 *
 * So every assertion here is on the *outcome* — the collection's item count,
 * the todo row's collection pill, the order of sidebar rows — after a real
 * drag driven by the browser.
 *
 * Each spec seeds its own context. The fixture is cheap next to a 30 s test
 * budget, and sharing it would let the first broken gesture mask the rest —
 * exactly the failure mode that let these bugs reach a release.
 */

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from '../helpers/fixtures';
import {
  card,
  collectionCount,
  dragGripPast,
  expandSidebarGroup,
  FIXTURE,
  gotoPage,
  seedSidebarFixture,
  sidebarCollection,
  sidebarCollectionNames,
  sidebarCollectionRow,
  sidebarGroupNames,
  sidebarGroupRow,
  todoRow,
  todoRowCollectionPill,
} from '../helpers/sidebar-drag';

const [WORK, HOME] = FIXTURE.groups;
const [ALPHA, BETA, GAMMA] = FIXTURE.collections;

let context: BrowserContext;
let page: Page;

test.beforeEach(async ({ browser, webOrigin }) => {
  test.setTimeout(90_000);
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  // The sidebar (and therefore every drop target here) only exists in the
  // opt-in sidebar layout; the default classic shell puts groups in a top bar.
  await context.addInitScript(() =>
    localStorage.setItem('inbox-rs:layout', 'sidebar'),
  );
  page = await context.newPage();
  await seedSidebarFixture(page, webOrigin);
  await expandSidebarGroup(page, WORK);
});

test.afterEach(async () => {
  await context?.close();
});

test('an inbox card dropped on a sidebar collection is filed there', async () => {
  await gotoPage(page, 'Inbox');
  await expect(card(page, FIXTURE.inboxCard)).toBeVisible();

  const before = await collectionCount(page, BETA);
  await card(page, FIXTURE.inboxCard).dragTo(sidebarCollection(page, BETA));

  await expect.poll(() => collectionCount(page, BETA)).toBe(before + 1);
  // Filing removes it from the unfiled inbox list.
  await expect(card(page, FIXTURE.inboxCard)).toHaveCount(0);
});

test('a todo dropped on a sidebar collection is filed there', async () => {
  await gotoPage(page, /^Todos/);
  await expect(todoRowCollectionPill(page, FIXTURE.unfiledTodo)).toHaveText(
    'Unfiled',
  );

  const before = await collectionCount(page, GAMMA);
  await todoRow(page, FIXTURE.unfiledTodo).dragTo(
    sidebarCollection(page, GAMMA),
  );

  await expect(todoRowCollectionPill(page, FIXTURE.unfiledTodo)).toHaveText(
    GAMMA,
  );
  await expect.poll(() => collectionCount(page, GAMMA)).toBe(before + 1);
});

test('a card in a collection view refiles onto another sidebar collection', async () => {
  await gotoPage(page, 'Collections');
  await expect(card(page, FIXTURE.filedCard)).toBeVisible();

  const alphaBefore = await collectionCount(page, ALPHA);
  const betaBefore = await collectionCount(page, BETA);
  await card(page, FIXTURE.filedCard).dragTo(sidebarCollection(page, BETA));

  await expect.poll(() => collectionCount(page, BETA)).toBe(betaBefore + 1);
  await expect.poll(() => collectionCount(page, ALPHA)).toBe(alphaBefore - 1);
  // Beta is collapsed, so a refiled card must disappear from the page rather
  // than linger in the list it was dragged out of.
  await expect(card(page, FIXTURE.filedCard)).toHaveCount(0);
});

test('a todo in a collection view refiles onto another sidebar collection', async () => {
  await gotoPage(page, 'Collections');
  await expect(todoRow(page, FIXTURE.filedTodo)).toBeVisible();

  const alphaBefore = await collectionCount(page, ALPHA);
  const gammaBefore = await collectionCount(page, GAMMA);
  await todoRow(page, FIXTURE.filedTodo).dragTo(sidebarCollection(page, GAMMA));

  await expect.poll(() => collectionCount(page, GAMMA)).toBe(gammaBefore + 1);
  await expect.poll(() => collectionCount(page, ALPHA)).toBe(alphaBefore - 1);
  await expect(todoRow(page, FIXTURE.filedTodo)).toHaveCount(0);
});

test('sidebar collections reorder when dragged by their grip', async () => {
  await gotoPage(page, 'Collections');
  await expect
    .poll(() => sidebarCollectionNames(page))
    .toEqual([ALPHA, BETA, GAMMA]);

  await dragGripPast(
    page,
    sidebarCollectionRow(page, ALPHA).locator('.collection-reorder-handle'),
    sidebarCollectionRow(page, GAMMA),
  );

  // Dragging the first collection past the last puts it at the end. Polling
  // the whole list also rides out the drop animation, during which the zone
  // still holds a placeholder row.
  await expect
    .poll(() => sidebarCollectionNames(page))
    .toEqual([BETA, GAMMA, ALPHA]);
});

test('sidebar groups reorder when dragged by their grip', async () => {
  await expect.poll(() => sidebarGroupNames(page)).toEqual([WORK, HOME]);

  await dragGripPast(
    page,
    sidebarGroupRow(page, WORK).locator('.group-reorder-handle'),
    sidebarGroupRow(page, HOME),
  );

  await expect.poll(() => sidebarGroupNames(page)).toEqual([HOME, WORK]);
});
