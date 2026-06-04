/**
 * Quick Capture PWA — end-to-end demo of the `/capture/` entry point.
 */

import { listInboxItems, oauthTokenForCapture } from '../helpers/armadietto';
import { clearCaptureStorage, seedCaptureSession } from '../helpers/capture';
import { expect, test } from '../helpers/fixtures';
import {
  assertNoConsoleErrors,
  attachConsoleCapture,
  seedRsSession,
} from '../helpers/pwa';

const captureUrl = (origin: string) => `${origin}/capture/`;

test.describe('Quick Capture PWA', () => {
  test('capture manifest is served and scoped to /capture/', async ({
    webOrigin,
    request,
  }) => {
    const resp = await request.get(`${webOrigin}/capture/manifest.webmanifest`);
    expect(resp.status()).toBe(200);

    const manifest = (await resp.json()) as {
      name?: string;
      start_url?: string;
      scope?: string;
      display?: string;
      icons?: Array<{ src: string; sizes?: string }>;
    };
    expect(manifest.name).toContain('Quick Capture');
    expect(manifest.start_url).toBe('/capture/');
    expect(manifest.scope).toBe('/capture/');
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(
      manifest.display,
    );

    const bigIcons = (manifest.icons ?? []).filter((i) =>
      (i.sizes ?? '')
        .split(/\s+/)
        .some((s) => parseInt(s.split('x')[0] ?? '0', 10) >= 192),
    );
    expect(bigIcons.length).toBeGreaterThan(0);
  });

  test('capture page renders the input shell', async ({ page, webOrigin }) => {
    await page.goto(captureUrl(webOrigin));
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: 'Quick Capture' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Full app' })).toHaveAttribute(
      'href',
      '/',
    );
    await expect(page.getByRole('button', { name: 'Note' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Todo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bookmark' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('full connect round-trip via OAuth on capture page', async ({
    page,
    webOrigin,
    freshRsUser,
  }) => {
    const log = attachConsoleCapture(page);
    await page.goto(captureUrl(webOrigin));
    await page.waitForLoadState('networkidle');

    await page
      .getByPlaceholder('user@storage.example')
      .fill(freshRsUser.address);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    await page.waitForURL(/^http:\/\/localhost:8000\/oauth\//, {
      timeout: 10_000,
    });
    await page.locator('input[name="password"]').fill(freshRsUser.password);
    await page.locator('button[name="allow"]').click();

    await page.waitForURL(`${webOrigin}/capture/**`, { timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Connected')).toBeVisible();
    await expect(page.getByText(freshRsUser.address)).toBeVisible();
    assertNoConsoleErrors(log);
  });

  test('captures a note and syncs it to remoteStorage', async ({
    context,
    freshRsUser,
    webOrigin,
  }) => {
    const captureToken = await oauthTokenForCapture(freshRsUser, {
      clientOrigin: webOrigin,
    });
    await clearCaptureStorage(context);
    await seedCaptureSession(context, freshRsUser, captureToken, {
      clientOrigin: webOrigin,
    });

    const page = await context.newPage();
    const log = attachConsoleCapture(page);
    await page.goto(captureUrl(webOrigin));
    await page.waitForLoadState('networkidle');

    const sentinel = 'capture-e2e-note-α';
    await page.getByRole('button', { name: 'Note' }).click();
    await page
      .getByPlaceholder('Jot something down...')
      .fill(`Title line\n${sentinel}`);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Synced')).toBeVisible({ timeout: 15_000 });

    const queueRaw = await page.evaluate(() =>
      localStorage.getItem('inbox-rs-capture:queue'),
    );
    expect(JSON.parse(queueRaw ?? '[]')).toEqual([]);

    const itemsOnServer = await listInboxItems(freshRsUser, captureToken);
    expect(
      itemsOnServer.some(
        (item) => item.type === 'note' && item.body?.includes(sentinel),
      ),
    ).toBe(true);
    assertNoConsoleErrors(log);
    await page.close();
  });

  test('captures todo and bookmark types with correct shape', async ({
    context,
    freshRsUser,
    webOrigin,
  }) => {
    const captureToken = await oauthTokenForCapture(freshRsUser, {
      clientOrigin: webOrigin,
    });
    await clearCaptureStorage(context);
    await seedCaptureSession(context, freshRsUser, captureToken, {
      clientOrigin: webOrigin,
    });

    const page = await context.newPage();
    await page.goto(captureUrl(webOrigin));
    await page.waitForLoadState('networkidle');

    const todoText = 'capture-e2e-todo-β';
    await page.getByRole('button', { name: 'Todo' }).click();
    await page.getByPlaceholder('What needs doing?').fill(todoText);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Synced')).toBeVisible({ timeout: 15_000 });

    const bookmarkUrl = 'example.com/capture-e2e';
    await page.getByRole('button', { name: 'Bookmark' }).click();
    await page.getByPlaceholder('https://example.com').fill(bookmarkUrl);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Synced')).toBeVisible({ timeout: 15_000 });

    const serverItems = await listInboxItems(freshRsUser, captureToken);

    const todo = serverItems.find((item) => item.type === 'todo');
    expect(todo?.type === 'todo' && todo.title).toBe(todoText);
    if (todo?.type === 'todo') {
      expect(todo.isTodo).toBe(true);
      expect(todo.completed).toBe(false);
    }

    const bookmark = serverItems.find((item) => item.type === 'bookmark');
    expect(bookmark?.type === 'bookmark' && bookmark.url).toBe(
      `https://${bookmarkUrl}`,
    );

    await page.close();
  });

  test('queues captures offline then syncs when back online', async ({
    context,
    freshRsUser,
    webOrigin,
  }) => {
    const captureToken = await oauthTokenForCapture(freshRsUser, {
      clientOrigin: webOrigin,
    });

    const page = await context.newPage();
    await page.goto(captureUrl(webOrigin));
    await page.waitForLoadState('networkidle');

    await context.setOffline(true);
    const offlineNote = 'capture-e2e-offline-γ';
    await page.getByPlaceholder('Jot something down...').fill(offlineNote);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(
      page.getByText('Saved locally. Connect to sync.'),
    ).toBeVisible();
    await expect(page.getByText('1 queued')).toBeVisible();

    const queueLen = await page.evaluate(() => {
      const raw = localStorage.getItem('inbox-rs-capture:queue');
      return raw ? (JSON.parse(raw) as unknown[]).length : 0;
    });
    expect(queueLen).toBe(1);

    await context.setOffline(false);
    await seedCaptureSession(context, freshRsUser, captureToken, {
      clientOrigin: webOrigin,
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Synced')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('queued')).toHaveCount(0);

    const itemsAfterSync = await listInboxItems(freshRsUser, captureToken);
    expect(
      itemsAfterSync.some(
        (item) =>
          item.type === 'note' &&
          (item.body?.includes(offlineNote) ||
            item.title?.includes(offlineNote)),
      ),
    ).toBe(true);

    await page.close();
  });

  test('captured items surface in the main inbox app', async ({
    context,
    freshRsUser,
    freshRsToken,
    webOrigin,
  }) => {
    const captureToken = await oauthTokenForCapture(freshRsUser, {
      clientOrigin: webOrigin,
    });
    await clearCaptureStorage(context);
    await seedCaptureSession(context, freshRsUser, captureToken, {
      clientOrigin: webOrigin,
    });

    const capturePage = await context.newPage();
    await capturePage.goto(captureUrl(webOrigin));
    await capturePage.waitForLoadState('networkidle');

    const crossAppSentinel = 'capture-e2e-cross-app-δ';
    await capturePage
      .getByPlaceholder('Jot something down...')
      .fill(crossAppSentinel);
    await capturePage.getByRole('button', { name: 'Save' }).click();
    await expect(capturePage.getByText('Synced')).toBeVisible({
      timeout: 15_000,
    });
    await capturePage.close();

    await seedRsSession(context, freshRsUser, freshRsToken, {
      clientOrigin: webOrigin,
    });

    const mainPage = await context.newPage();
    await mainPage.goto(webOrigin);
    await mainPage.waitForLoadState('networkidle');

    await expect(
      mainPage.getByRole('button', { name: 'User menu — connected' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(mainPage.getByText(crossAppSentinel)).toBeVisible({
      timeout: 15_000,
    });
    await mainPage.close();
  });

  test('main app user menu links to Quick Capture', async ({
    page,
    webOrigin,
  }) => {
    await page.goto(webOrigin);
    await page.waitForLoadState('networkidle');

    await page
      .getByRole('button', { name: 'User menu — disconnected' })
      .click();
    const captureLink = page.getByRole('menuitem', {
      name: 'Install capture app',
    });
    await expect(captureLink).toHaveAttribute('href', '/capture/');
  });
});
