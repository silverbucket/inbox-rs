/**
 * Locators and seeding for the sidebar drag-and-drop specs.
 *
 * These helpers only ever assert on state the user can see — a collection's
 * item count, a todo row's collection pill, the order of sidebar rows. The
 * point of the specs that use them is that a drag actually *moves the item*,
 * so nothing here inspects drag payloads or dataTransfer MIME types.
 *
 * Seeding runs through the real UI (inline group/collection creation, the
 * capture bar, the todo quick-add) rather than writing storage directly, so
 * the fixture can't drift away from what the app produces.
 */

import { expect, type Locator, type Page } from '@playwright/test';

/** Text input locators, matched on placeholder prefix. */
const input = (page: Page, placeholderPrefix: string): Locator =>
  page.locator(`input[placeholder^="${placeholderPrefix}"]`);

const exactName = (page: Page, name: string): Locator =>
  page.locator('.entity-name', { hasText: new RegExp(`^${name}$`) });

/** A sidebar collection row: reorder grip, filter button, move-to-group button. */
export function sidebarCollectionRow(page: Page, name: string): Locator {
  return page.locator('.collection-drag-row', { has: exactName(page, name) });
}

/** The clickable/droppable collection button inside a sidebar collection row. */
export function sidebarCollection(page: Page, name: string): Locator {
  return sidebarCollectionRow(page, name).locator('.collection-entity');
}

/**
 * The move button on a sidebar collection row.
 *
 * Both halves of "move to another group" hang off this one control: drag it
 * onto a group row, or click it to open the menu of groups. It is deliberately
 * the only drag source for that gesture — a native drag on the row body would
 * swallow the row's own click, which is the show/hide filter toggle.
 */
export function sidebarCollectionMoveButton(page: Page, name: string): Locator {
  return sidebarCollectionRow(page, name).locator('.collection-move-btn');
}

/** A sidebar group row: reorder grip, expand chevron, filter button. */
export function sidebarGroupRow(page: Page, name: string): Locator {
  return page.locator('.group-row', { has: exactName(page, name) });
}

/** Number of items filed in a sidebar collection, as rendered in its badge. */
export async function collectionCount(
  page: Page,
  name: string,
): Promise<number> {
  const text = await sidebarCollection(page, name)
    .locator('.count')
    .innerText();
  return Number(text.trim());
}

/** Order of the group names currently listed in the sidebar. */
export function sidebarGroupNames(page: Page): Promise<string[]> {
  return page
    .locator('.group-entity .entity-name')
    .allInnerTexts()
    .then((names) => names.map((n) => n.trim()));
}

/**
 * Which collections the sidebar lists under each group, in display order.
 *
 * Keyed by group name, so it proves *membership* rather than just that some
 * count changed — the thing "move this collection into that group" is about.
 */
export function sidebarCollectionsByGroup(
  page: Page,
): Promise<Record<string, string[]>> {
  return page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll('.groups-dnd > .group')).map(
        (group) => [
          (
            group.querySelector('.group-entity .entity-name')?.textContent ?? ''
          ).trim(),
          Array.from(
            group.querySelectorAll('.collection-drag-row .entity-name'),
          ).map((name) => (name.textContent ?? '').trim()),
        ],
      ),
    ),
  );
}

/** Order of the collection names currently listed in the sidebar. */
export function sidebarCollectionNames(page: Page): Promise<string[]> {
  return page
    .locator('.collection-entity .entity-name')
    .allInnerTexts()
    .then((names) => names.map((n) => n.trim()));
}

/** A todo row anywhere on the page, located by its title. */
export function todoRow(page: Page, title: string): Locator {
  return page.locator('li.todo-row', {
    has: page.getByText(title, { exact: true }),
  });
}

/** The collection a todo row says it lives in ("Unfiled" when it has none). */
export function todoRowCollectionPill(page: Page, title: string): Locator {
  return todoRow(page, title).locator('.pill-name');
}

/** An inbox/reference card, located by its title text. */
export function card(page: Page, title: string): Locator {
  return page.locator('article.card', {
    has: page.getByText(title, { exact: true }),
  });
}

export async function gotoPage(
  page: Page,
  label: 'Inbox' | 'Collections' | RegExp,
): Promise<void> {
  await page.getByRole('button', { name: label }).first().click();
}

/** Expand a sidebar group so its collections (the drop targets) are rendered. */
export async function expandSidebarGroup(
  page: Page,
  name: string,
): Promise<void> {
  const chevron = page.locator(`.sidebar [aria-label="Expand ${name}"]`);
  if (await chevron.count()) await chevron.first().click();
}

async function addGroup(page: Page, name: string): Promise<void> {
  const field = input(page, 'Name a group');
  // Submitting a group closes its inline form, but only once the store write
  // resolves. Opening the next one before that lands would have the pending
  // close tear down the field we are about to type into.
  await expect(field).toHaveCount(0);

  const firstRun = page.getByRole('button', {
    name: 'Create your first group',
  });
  if (await firstRun.count()) await firstRun.click();
  else await page.getByRole('button', { name: 'New group' }).first().click();

  await expect(field).toBeVisible();
  await field.fill(name);
  await field.press('Enter');
  await expect(sidebarGroupRow(page, name)).toBeVisible();
}

async function addCollections(
  page: Page,
  group: string,
  names: readonly string[],
): Promise<void> {
  await page
    .getByRole('button', { name: `Add collection to ${group}` })
    .click();
  const field = input(page, 'Name a collection');
  await expect(field).toBeVisible();
  for (const name of names) {
    await field.fill(name);
    await field.press('Enter');
    await expect(sidebarCollectionRow(page, name)).toBeVisible();
    // The form stays open for the next name and clears itself when the write
    // resolves — which is *after* the new row renders. Typing before then
    // would get wiped and submit an empty name.
    await expect(field).toHaveValue('');
  }
  await field.press('Escape');
}

/** Capture a reference item through the capture bar in the current view. */
async function captureReference(page: Page, title: string): Promise<void> {
  const bar = input(page, 'Paste a link').first();
  await expect(bar).toBeVisible();
  await bar.fill(title);
  await bar.press('Enter');
  await expect(card(page, title)).toBeVisible({ timeout: 15_000 });
}

/** Add a todo through the quick-add composer in the current view. */
async function addTodo(page: Page, title: string): Promise<void> {
  const field = page
    .locator(
      'input[placeholder^="What needs doing"], input[placeholder^="Add a todo"]',
    )
    .first();
  await expect(field).toBeVisible();
  await field.fill(title);
  await field.press('Enter');
  await expect(todoRow(page, title)).toBeVisible({ timeout: 15_000 });
}

export const FIXTURE = {
  groups: ['Work', 'Home'] as const,
  collections: ['Alpha', 'Beta', 'Gamma'] as const,
  /** Unfiled reference item, sitting in the inbox. */
  inboxCard: 'Sidebar drag card',
  /** Unfiled todo, sitting on the todos page. */
  unfiledTodo: 'Sidebar drag todo',
  /** Reference item created *inside* Alpha, for the refile-from-collections flow. */
  filedCard: 'Filed drag card',
  /** Todo created *inside* Alpha, for the refile-from-collections flow. */
  filedTodo: 'Filed drag todo',
} as const;

/**
 * Build the shared fixture: two groups, three collections under the first,
 * an unfiled card, an unfiled todo, and one card + one todo already filed
 * in `Alpha`.
 *
 * The filed pair is created from inside the collection view (its own capture
 * bar and quick-add) rather than by dragging, so the refile specs don't
 * depend on the very behaviour they're checking.
 */
export async function seedSidebarFixture(
  page: Page,
  webOrigin: string,
): Promise<void> {
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  for (const group of FIXTURE.groups) await addGroup(page, group);
  await addCollections(page, FIXTURE.groups[0], FIXTURE.collections);

  await captureReference(page, FIXTURE.inboxCard);

  await gotoPage(page, /^Todos/);
  await addTodo(page, FIXTURE.unfiledTodo);

  await gotoPage(page, 'Collections');
  await page
    .locator(`main [aria-label="Expand ${FIXTURE.collections[0]}"]`)
    .first()
    .click();
  await captureReference(page, FIXTURE.filedCard);
  await addTodo(page, FIXTURE.filedTodo);
  await expect
    .poll(() => collectionCount(page, FIXTURE.collections[0]))
    .toBe(2);
}

type Point = { x: number; y: number };

/**
 * Walk the pointer from `from` to `to` with the button held, settle on the
 * target, then release.
 *
 * Deliberately *not* `locator.dragTo()`. `dragTo` puts the pointer down, jumps
 * to the target and releases, which produces a single `dragover` immediately
 * followed by `drop` at one fixed coordinate. That cannot observe anything that
 * goes wrong *during* a drag — and the real bug here was exactly that: hover
 * feedback reflowed the row under the cursor, each reflow retargeted the drag,
 * and the browser cancelled the gesture instead of dropping. `dragTo` reported
 * six passing specs while the feature was unusable by hand.
 *
 * Stepping the pointer produces a stream of `dragover`s at moving coordinates
 * (the same thing a mouse does) and the settle phase gives the browser time to
 * emit a final `dragover` on the target, which is what licenses the `drop`.
 */
async function steppedDrag(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();

  const steps = 16;
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps,
    );
    await page.waitForTimeout(20);
  }

  // Jitter and pause on the target, as a hand does. Without this the pointer
  // can arrive on its final step and release before a `dragover` lands.
  const jitter: ReadonlyArray<Point> = [
    { x: 1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: -1 },
  ];
  for (const nudge of jitter) {
    await page.mouse.move(to.x + nudge.x, to.y + nudge.y);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(250);
  await page.mouse.up();
}

async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${what} must be laid out to be dragged`);
  return box;
}

/**
 * Drag an item (card or todo row) onto a drop target with a real stepped drag.
 *
 * `aimFraction` picks where across the target's width to release: 0.5 is the
 * middle, 0.85 lands on the right-hand end of a sidebar collection row where
 * the reorder grip and move button sit. That end used to be dead space, so
 * tests that only ever aimed at the middle never noticed.
 */
export async function dragItemOnto(
  page: Page,
  item: Locator,
  target: Locator,
  { aimFraction = 0.5 }: { aimFraction?: number } = {},
): Promise<void> {
  const source = await boxOf(item, 'the dragged item');
  const dest = await boxOf(target, 'the drop target');
  await steppedDrag(
    page,
    // Low on the card body, clear of the title link and action buttons.
    { x: source.x + source.width / 2, y: source.y + source.height - 12 },
    { x: dest.x + dest.width * aimFraction, y: dest.y + dest.height / 2 },
  );
}

/**
 * Drag a collection onto a group row, moving it into that group.
 *
 * Grabs the move button, which is the only drag source for this gesture. Not
 * the grip (that runs svelte-dnd-action's pointer reorder within the group)
 * and not the row body (a native drag there suppresses the row's click, which
 * is the show/hide filter toggle).
 */
export async function dragCollectionOntoGroup(
  page: Page,
  collectionRow: Locator,
  groupRow: Locator,
): Promise<void> {
  const from = await boxOf(
    collectionRow.locator('.collection-move-btn'),
    'the dragged collection',
  );
  const to = await boxOf(groupRow, 'the destination group row');
  await steppedDrag(
    page,
    { x: from.x + from.width / 2, y: from.y + from.height / 2 },
    { x: to.x + to.width / 2, y: to.y + to.height / 2 },
  );
}

/**
 * Drag a svelte-dnd-action grip onto the middle of `target` to reorder.
 *
 * `overshootPx` releases that far *below* the target instead, which is what a
 * hand does when dragging something to the end of a list. svelte-dnd-action
 * used to judge position by the centre of the dragged element rather than the
 * cursor, so an overshoot — or merely dragging a tall expanded group — put that
 * centre outside the zone and the library reverted the reorder as "dropped
 * outside of any". Tests that stop neatly on the target never see it.
 */
export async function dragGripPast(
  page: Page,
  handle: Locator,
  target: Locator,
  { overshootPx = 0 }: { overshootPx?: number } = {},
): Promise<void> {
  const from = await boxOf(handle, 'the drag handle');
  const to = await boxOf(target, 'the reorder target');
  await steppedDrag(
    page,
    { x: from.x + from.width / 2, y: from.y + from.height / 2 },
    {
      x: from.x + from.width / 2,
      y: overshootPx ? to.y + to.height + overshootPx : to.y + to.height / 2,
    },
  );
}
