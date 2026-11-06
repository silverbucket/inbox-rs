/**
 * Ctrl/Cmd-Shift-Enter in the inbox capture bar adds the typed text straight
 * to Todos (issue #311). The bar hints the shortcut while it holds text, and
 * the toast names where the todo went and offers Undo.
 */

import { expect, test } from '../helpers/fixtures';
import { assertNoConsoleErrors, attachConsoleCapture } from '../helpers/pwa';

test('capture bar hints and runs the add-as-todo shortcut', async ({
  connectedPage: page,
  webOrigin,
}) => {
  const log = attachConsoleCapture(page);
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  const capture = page.getByPlaceholder(
    'Paste a link, jot a note, or drop a file…',
  );
  const hint = page.locator('.capture .hint');
  await capture.click();
  await expect(hint).not.toContainText('Add as todo');

  const title = `capture todo shortcut ${Date.now()}`;
  await capture.fill(title);
  await expect(hint).toContainText(/(⌘|Ctrl)⇧↵ Add as todo/);

  await capture.press('ControlOrMeta+Shift+Enter');
  const toast = page.getByRole('status').filter({ hasText: 'Added to Todos' });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(capture).toHaveValue('');
  // Added directly — no editor opened on top.
  await expect(page.getByRole('heading', { name: 'Add Todo' })).toHaveCount(0);

  await page.goto(`${webOrigin}/#/todos`);
  await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });

  assertNoConsoleErrors(log);
});

test('Undo on the add-as-todo toast removes the todo', async ({
  connectedPage: page,
  webOrigin,
}) => {
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  const capture = page.getByPlaceholder(
    'Paste a link, jot a note, or drop a file…',
  );
  const title = `capture todo undo ${Date.now()}`;
  await capture.fill(title);
  await capture.press('ControlOrMeta+Shift+Enter');
  const toast = page.getByRole('status').filter({ hasText: 'Added to Todos' });
  await toast.getByRole('button', { name: 'Undo' }).click();

  await page.goto(`${webOrigin}/#/todos`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(title)).toHaveCount(0);
});
