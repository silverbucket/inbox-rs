/**
 * Organizing a card from its modal is undoable, like triage is.
 *
 * Archiving or filing a card from the card modal closes the modal, so the
 * card vanishes from the inbox. The toast that confirms it must offer Undo,
 * and Undo must put the card back where it was.
 */

import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/fixtures';
import {
  assertNoConsoleErrors,
  attachConsoleCapture,
  seedRsSession,
} from '../helpers/pwa';

async function captureNote(page: Page, title: string): Promise<void> {
  const input = page.getByPlaceholder(
    'Paste a link, jot a note, or drop a file…',
  );
  await input.click();
  await input.fill(title);
  await input.press('Enter');
  await expect(page.getByRole('button', { name: `Open ${title}` })).toBeVisible(
    { timeout: 10_000 },
  );
}

async function openCard(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: `Open ${title}` }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
}

test.beforeEach(async ({ context, freshRsUser, freshRsToken, webOrigin }) => {
  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
});

test('archiving a card from its modal offers Undo that brings it back', async ({
  context,
  webOrigin,
}) => {
  const page = await context.newPage();
  const log = attachConsoleCapture(page);
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  const title = 'modal archive undo note';
  await captureNote(page, title);
  await openCard(page, title);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Archive card' })
    .click();

  const toast = page.getByRole('status').filter({ hasText: 'Archived' });
  await expect(toast).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${title}` }),
  ).not.toBeVisible();

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: `Open ${title}` })).toBeVisible(
    { timeout: 10_000 },
  );

  assertNoConsoleErrors(log);
});

test('filing a card from its modal offers Undo that returns it to the inbox', async ({
  context,
  webOrigin,
}) => {
  const page = await context.newPage();
  const log = attachConsoleCapture(page);
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  const title = 'modal file undo note';
  await captureNote(page, title);
  await openCard(page, title);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'File into collection…' })
    .click();

  // A fresh account has no collections: create one from the picker.
  await page.getByRole('button', { name: /New collection/ }).click();
  const name = page.getByPlaceholder('Collection name');
  await expect(name).toBeFocused();
  await name.fill('Undo Shelf');
  const group = page.getByPlaceholder('Group name');
  await group.fill('Undo Group');
  await expect(name).toHaveValue('Undo Shelf');
  await page.getByRole('button', { name: 'Create & file' }).click();

  const toast = page
    .getByRole('status')
    .filter({ hasText: 'Filed to Undo Shelf' });
  await expect(toast).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${title}` }),
  ).not.toBeVisible();

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: `Open ${title}` })).toBeVisible(
    { timeout: 10_000 },
  );

  assertNoConsoleErrors(log);
});
