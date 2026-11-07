/**
 * Ctrl/Cmd-Shift-Enter in the inbox capture bar opens the todo editor with
 * the typed text (issue #311), the same way ⌘↵ carries it into the card
 * editor and ⌘⇧↵ does on the Todos page. It used to open an empty editor and
 * leave the text behind. The bar hints the shortcut while it holds text.
 */

import { expect, test } from '../helpers/fixtures';
import { assertNoConsoleErrors, attachConsoleCapture } from '../helpers/pwa';

test('capture bar hints the todo shortcut and carries the text into the editor', async ({
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
  await expect(hint).not.toContainText('Open as todo');

  const title = `capture todo shortcut ${Date.now()}`;
  await capture.fill(title);
  await expect(hint).toContainText(/(⌘|Ctrl)⇧↵ Open as todo/);

  await capture.press('ControlOrMeta+Shift+Enter');
  const editor = page.getByRole('dialog', { name: 'Add Todo' });
  await expect(editor).toBeVisible();
  const field = editor.getByPlaceholder('What needs to be done?');
  await expect(field).toHaveValue(title);
  await expect(capture).toHaveValue('');

  // One more Enter saves it.
  await field.press('Enter');
  await expect(editor).toHaveCount(0);
  await page.goto(`${webOrigin}/#/todos`);
  await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });

  assertNoConsoleErrors(log);
});
