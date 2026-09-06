/**
 * Global search: the `#/search?q=` page, the header button, the `/` and
 * ⌘/Ctrl+K shortcuts, and results drawn from every surface (inbox cards,
 * filed references, todos).
 *
 * Items are seeded straight into storage before the app connects, so the
 * results here reflect a real sync round-trip rather than local state.
 */

import type { InboxItem } from '@inbox-rs/rs-module';
import { putInboxItem } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import {
  assertNoConsoleErrors,
  attachConsoleCapture,
  seedRsSession,
} from '../helpers/pwa';

const SEEDED: InboxItem[] = [
  {
    id: 'search-note-1',
    type: 'note',
    title: 'Sourdough starter log',
    body: 'fed the starter with rye flour, very bubbly',
    createdAt: '2026-08-01T10:00:00.000Z',
  },
  {
    id: 'search-todo-1',
    type: 'todo',
    title: 'Bake sourdough on Saturday',
    completed: false,
    createdAt: '2026-08-02T10:00:00.000Z',
  },
  {
    id: 'search-note-2',
    type: 'note',
    title: 'Garden watering schedule',
    body: 'tomatoes every other day',
    createdAt: '2026-08-03T10:00:00.000Z',
  },
];

test.describe('search', () => {
  test('finds seeded cards and todos, and mirrors the query in the URL', async ({
    browser,
    freshRsUser,
    freshRsToken,
    webOrigin,
  }) => {
    for (const item of SEEDED) {
      await putInboxItem(freshRsUser, freshRsToken, { item });
    }
    const context = await browser.newContext();
    await seedRsSession(context, freshRsUser, freshRsToken, {
      clientOrigin: webOrigin,
    });
    const page = await context.newPage();
    const log = attachConsoleCapture(page);
    await page.goto(webOrigin);
    await page.waitForLoadState('networkidle');

    // Wait for the sync to land before searching, so an empty result can't
    // be mistaken for "not synced yet".
    await expect(page.getByText('Sourdough starter log')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/#\/search$/);
    const box = page.getByRole('searchbox', { name: 'Search' });
    await expect(box).toBeFocused();

    await box.fill('sourdough');
    await expect(page).toHaveURL(/#\/search\?q=sourdough$/);

    // One todo (its own section) and one card; the garden note stays out.
    const todos = page.getByRole('region', { name: 'Matching todos' });
    const cards = page.getByRole('region', { name: 'Matching cards' });
    await expect(todos.getByText('Bake sourdough on Saturday')).toBeVisible();
    await expect(cards.getByText('Sourdough starter log')).toBeVisible();
    await expect(page.getByText('Garden watering schedule')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('2 results');

    // Body text matches too, and the header button reads as the current page.
    await box.fill('rye flour');
    await expect(cards.getByText('Sourdough starter log')).toBeVisible();
    await expect(todos).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Search', exact: true }),
    ).toHaveAttribute('aria-current', 'page');

    // A miss says so rather than showing a blank page.
    await box.fill('zeppelin');
    await expect(page.getByText('Nothing matches “zeppelin”')).toBeVisible();

    // Escape clears; the URL drops the query with it.
    await box.press('Escape');
    await expect(box).toHaveValue('');
    await expect(page).toHaveURL(/#\/search$/);

    assertNoConsoleErrors(log);
    await context.close();
  });

  test('deep link runs the search on load and reload', async ({
    browser,
    freshRsUser,
    freshRsToken,
    webOrigin,
  }) => {
    for (const item of SEEDED) {
      await putInboxItem(freshRsUser, freshRsToken, { item });
    }
    const context = await browser.newContext();
    await seedRsSession(context, freshRsUser, freshRsToken, {
      clientOrigin: webOrigin,
    });
    const page = await context.newPage();
    await page.goto(`${webOrigin}/#/search?q=garden+watering`);
    await page.waitForLoadState('networkidle');

    const box = page.getByRole('searchbox', { name: 'Search' });
    await expect(box).toHaveValue('garden watering');
    await expect(page.getByText('Garden watering schedule')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Sourdough starter log')).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(box).toHaveValue('garden watering');
    await expect(page.getByText('Garden watering schedule')).toBeVisible({
      timeout: 15_000,
    });

    await context.close();
  });

  test('keyboard shortcuts open search from other pages', async ({
    connectedPage,
    webOrigin,
  }) => {
    await connectedPage.goto(`${webOrigin}/#/todos`);
    await connectedPage.waitForLoadState('networkidle');
    await expect(
      connectedPage.getByRole('button', { name: 'Todos' }).first(),
    ).toHaveAttribute('aria-current', 'page');

    // `/` from the page body (nothing focused).
    await connectedPage.locator('body').click({ position: { x: 5, y: 5 } });
    await connectedPage.keyboard.press('/');
    await expect(connectedPage).toHaveURL(/#\/search$/);
    const box = connectedPage.getByRole('searchbox', { name: 'Search' });
    await expect(box).toBeFocused();
    // The keystroke that opened the page must not land in the field.
    await expect(box).toHaveValue('');

    // ⌘/Ctrl+K works even while the inbox capture bar holds focus (it
    // autofocuses, empty, on that page).
    await connectedPage.getByRole('button', { name: 'Inbox' }).first().click();
    const capture = connectedPage.getByPlaceholder(
      'Paste a link, jot a note, or drop a file…',
    );
    await expect(capture).toBeFocused();
    await connectedPage.keyboard.press('ControlOrMeta+k');
    await expect(connectedPage).toHaveURL(/#\/search$/);
    await expect(box).toBeFocused();

    // …but not when that field holds a draft: leaving would discard it.
    await connectedPage.getByRole('button', { name: 'Inbox' }).first().click();
    await capture.fill('half-written thought');
    await connectedPage.keyboard.press('ControlOrMeta+k');
    await expect(connectedPage).toHaveURL(/#\/?$/);
    await expect(capture).toHaveValue('half-written thought');
    // And `/` is plain text inside a field.
    await capture.press('/');
    await expect(capture).toHaveValue('half-written thought/');
    await expect(connectedPage).toHaveURL(/#\/?$/);
  });
});
