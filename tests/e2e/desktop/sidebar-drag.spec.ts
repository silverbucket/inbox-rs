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
 * Every assertion here is on the *outcome* — the collection's item count, the
 * todo row's collection pill, the order of sidebar rows — after a drag driven
 * through the browser's own drag machinery. Nothing inspects a drag payload: a
 * correct payload says nothing about whether the drop was delivered, and both
 * bugs this file guards against set the payload perfectly and then lost the
 * gesture.
 *
 * Read `dragItemOnto` in the helper before changing any of these: using
 * `locator.dragTo()` here is a false green. It emits one `dragover` and a
 * `drop` at a single fixed coordinate, so it cannot see a drop target that
 * misbehaves while the pointer is moving over it — which is precisely how
 * drag-to-file was broken while six specs passed.
 *
 * The filing drags aim at 0.85 across the collection row on purpose. That is
 * where the reorder grip and the move button sit, it is where a hand naturally
 * lands, and it used to reject every single drop.
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
  dragCollectionOntoGroup,
  dragGripPast,
  dragItemOnto,
  expandSidebarGroup,
  FIXTURE,
  gotoPage,
  seedSidebarFixture,
  sidebarCollectionNames,
  sidebarCollectionRow,
  sidebarCollectionsByGroup,
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
  // Aim at the right-hand end of the row, over the reorder grip and move
  // button — the region a user hits and that used to reject every drop.
  await dragItemOnto(
    page,
    card(page, FIXTURE.inboxCard),
    sidebarCollectionRow(page, BETA),
    {
      aimFraction: 0.85,
    },
  );

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
  await dragItemOnto(
    page,
    todoRow(page, FIXTURE.unfiledTodo),
    sidebarCollectionRow(page, GAMMA),
    { aimFraction: 0.85 },
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
  await dragItemOnto(
    page,
    card(page, FIXTURE.filedCard),
    sidebarCollectionRow(page, BETA),
    { aimFraction: 0.85 },
  );

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
  await dragItemOnto(
    page,
    todoRow(page, FIXTURE.filedTodo),
    sidebarCollectionRow(page, GAMMA),
    { aimFraction: 0.85 },
  );

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
    sidebarCollectionRow(page, ALPHA).locator('.reorder-grip'),
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
    sidebarGroupRow(page, WORK).locator('.reorder-grip'),
    sidebarGroupRow(page, HOME),
  );

  await expect.poll(() => sidebarGroupNames(page)).toEqual([HOME, WORK]);
});

test('a collection dragged onto another group moves into it', async () => {
  // Home is empty, so its chevron is disabled and it has no collection list —
  // the group row itself is the only thing to aim at. That is also the case
  // that has to work for a group you have just created.
  await expect
    .poll(() => sidebarCollectionsByGroup(page))
    .toEqual({ [WORK]: [ALPHA, BETA, GAMMA], [HOME]: [] });

  await dragCollectionOntoGroup(
    page,
    sidebarCollectionRow(page, BETA),
    sidebarGroupRow(page, HOME),
  );

  await expect
    .poll(() => sidebarCollectionsByGroup(page))
    .toEqual({ [WORK]: [ALPHA, GAMMA], [HOME]: [BETA] });
});

test('a sloppy click on a collection toggles its filter and moves nothing', async () => {
  // Chrome starts a native drag once the pointer travels ~3px with the button
  // down, and suppresses the click that would otherwise follow. So a native
  // drag source on the row body ate the show/hide filter toggle — the sidebar's
  // most-used control — for anyone whose hand moved a few pixels, and let a
  // slip onto a neighbouring group row move the collection with no warning.
  // Both gestures now start from the move button instead.
  //
  // Only a real mouse can catch this: a synthetic `.click()` reports success
  // whether or not the browser would have cancelled it.
  const entity = sidebarCollectionRow(page, BETA).locator('.collection-entity');
  const before = await entity.getAttribute('aria-pressed');
  const box = await entity.boundingBox();
  if (!box) throw new Error('the collection row must be laid out');

  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width * 0.4 + 12,
    box.y + box.height / 2 + 6,
  );
  await page.mouse.up();

  await expect(entity).not.toHaveAttribute('aria-pressed', before ?? '');
  await expect
    .poll(() => sidebarCollectionsByGroup(page))
    .toEqual({ [WORK]: [ALPHA, BETA, GAMMA], [HOME]: [] });
});

test('moving a collection between groups leaves reordering intact', async () => {
  // The two gestures share a row: the grip reorders within the group, the move
  // button beside it carries the collection across groups. Exercising both in
  // sequence guards against a fix for one silently disabling the other.
  await dragCollectionOntoGroup(
    page,
    sidebarCollectionRow(page, ALPHA),
    sidebarGroupRow(page, HOME),
  );
  await expect
    .poll(() => sidebarCollectionsByGroup(page))
    .toEqual({ [WORK]: [BETA, GAMMA], [HOME]: [ALPHA] });

  await dragGripPast(
    page,
    sidebarCollectionRow(page, BETA).locator('.reorder-grip'),
    sidebarCollectionRow(page, GAMMA),
  );
  await expect
    .poll(() => sidebarCollectionsByGroup(page))
    .toEqual({ [WORK]: [GAMMA, BETA], [HOME]: [ALPHA] });
});

test('a group released just past the last row still reorders', async () => {
  // `expandSidebarGroup` in beforeEach leaves Work expanded, so the dragged
  // element is several times taller than the row it is dropped after — and
  // this releases below the last group rather than neatly on it. Both are what
  // a hand does when moving something to the end of a list, and together they
  // used to revert the reorder silently. The zone carries a little slack below
  // its last row for exactly this; releasing far from the list still cancels.
  await expect.poll(() => sidebarGroupNames(page)).toEqual([WORK, HOME]);

  await dragGripPast(
    page,
    sidebarGroupRow(page, WORK).locator('.reorder-grip'),
    sidebarGroupRow(page, HOME),
    { overshootPx: 16 },
  );

  await expect.poll(() => sidebarGroupNames(page)).toEqual([HOME, WORK]);
});
