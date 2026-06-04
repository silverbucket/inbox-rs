/**
 * Recorded walkthrough of the Quick Capture PWA for demo / review.
 *
 * Run:
 *   npm test -w @inbox-rs/e2e -- demo/quick-capture-video.spec.ts \
 *     --config=playwright.demo.config.ts
 */

import { expect, test } from '../helpers/fixtures';

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:4173';
const captureUrl = `${WEB_ORIGIN}/capture/`;

async function pause(page: import('@playwright/test').Page, ms = 1200) {
  await page.waitForTimeout(ms);
}

test.describe.configure({ mode: 'serial' });

test('Quick Capture video demo', async ({ page, freshRsUser }) => {
  test.setTimeout(120_000);

  // 1. Open the capture shell
  await page.goto(captureUrl);
  await page.waitForLoadState('networkidle');
  await pause(page, 1500);

  // 2. Connect remoteStorage via OAuth
  await page.getByPlaceholder('user@storage.example').fill(freshRsUser.address);
  await pause(page, 600);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  await page.waitForURL(/^http:\/\/localhost:8000\/oauth\//, {
    timeout: 15_000,
  });
  await pause(page, 800);
  await page.locator('input[name="password"]').fill(freshRsUser.password);
  await pause(page, 400);
  await page.locator('button[name="allow"]').click();

  await page.waitForURL(`${WEB_ORIGIN}/capture/**`, { timeout: 15_000 });
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Connected')).toBeVisible();
  await pause(page, 1500);

  // 3. Capture a note
  await page.getByRole('button', { name: 'Note' }).click();
  await page
    .getByPlaceholder('Jot something down...')
    .fill('Quick idea: ship the capture app as a home-screen PWA');
  await pause(page, 800);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Synced')).toBeVisible({ timeout: 15_000 });
  await pause(page, 1200);

  // 4. Capture a todo
  await page.getByRole('button', { name: 'Todo' }).click();
  await page
    .getByPlaceholder('What needs doing?')
    .fill('Review Quick Capture PR');
  await pause(page, 800);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Synced')).toBeVisible({ timeout: 15_000 });
  await pause(page, 1200);

  // 5. Capture a bookmark
  await page.getByRole('button', { name: 'Bookmark' }).click();
  await page
    .getByPlaceholder('https://example.com')
    .fill('github.com/silverbucket/inbox-rs');
  await pause(page, 800);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Synced')).toBeVisible({ timeout: 15_000 });
  await pause(page, 1500);

  // 6. Open the main app and connect the same account
  await page.getByRole('link', { name: 'Full app' }).click();
  await page.waitForLoadState('networkidle');
  await pause(page, 1200);

  await page.getByRole('button', { name: 'User menu — disconnected' }).click();
  await pause(page, 500);
  await page.getByPlaceholder('user@storage.example').fill(freshRsUser.address);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  await page.waitForURL(/^http:\/\/localhost:8000\/oauth\//, {
    timeout: 15_000,
  });
  await page.locator('input[name="password"]').fill(freshRsUser.password);
  await page.locator('button[name="allow"]').click();

  await page.waitForURL(`${WEB_ORIGIN}/**`, { timeout: 15_000 });
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByRole('button', { name: 'User menu — connected' }),
  ).toBeVisible({ timeout: 15_000 });
  await pause(page, 2000);

  // 7. Show captured items synced into the inbox
  await expect(page.getByText('Quick idea: ship the capture app')).toBeVisible({
    timeout: 20_000,
  });
  await pause(page, 2500);
});
