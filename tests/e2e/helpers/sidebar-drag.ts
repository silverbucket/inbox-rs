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

/**
 * Drag `handle` (a svelte-dnd-action grip) far enough past `target` that the
 * library reorders the list, then release.
 *
 * svelte-dnd-action is pointer-driven: it needs a mousedown on the handle, a
 * few intermediate moves (it ignores movement under 3px and polls
 * intersections on a timer), and a mouseup. A single `mouse.move` jump is not
 * enough, which is why this walks the pointer in steps.
 */
export async function dragGripPast(
  page: Page,
  handle: Locator,
  target: Locator,
): Promise<void> {
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('drag handle and target must be laid out');

  const x = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  const endY = to.y + to.height - 4;

  await page.mouse.move(x, startY);
  await page.mouse.down();
  const steps = 14;
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(x, startY + ((endY - startY) * step) / steps);
    await page.waitForTimeout(35);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
}
