/**
 * Ctrl/Cmd-Enter in the inbox capture bar opens the full note editor modal
 * with the typed text pre-filled as the title (the `onopeneditor` path).
 *
 * Pressing plain Enter saves instantly; pressing Ctrl/Cmd-Enter instead opens
 * AddEntryModal with `type="note"` and `prefillTitle` set to the captured
 * text.  The modal's title input should carry the typed text, and the modal
 * heading should read "Add Note".
 */

import { expect, test } from '../helpers/fixtures';
import { assertNoConsoleErrors, attachConsoleCapture } from '../helpers/pwa';

test('Ctrl+Enter opens the note editor modal pre-filled with the capture bar text', async ({
  connectedPage,
  webOrigin,
}) => {
  const log = attachConsoleCapture(connectedPage);
  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');

  // Navigate to the inbox view where the desktop capture bar is rendered.
  await connectedPage.getByRole('button', { name: 'Inbox' }).first().click();

  // Dotless sentinel → detected as a note (not a bare-domain bookmark).
  const sentinel = 'playwright open editor sentinel';
  const input = connectedPage.getByPlaceholder(
    'Paste a link, jot a note, or drop a file…',
  );
  await input.click();
  await input.fill(sentinel);

  // Ctrl+Enter triggers `onopeneditor` instead of `oncapture`.
  await input.press('Control+Enter');

  // The AddEntryModal should appear with role="dialog" and heading "Add Note".
  const dialog = connectedPage.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(
    connectedPage.getByRole('heading', { name: 'Add Note' }),
  ).toBeVisible({ timeout: 10_000 });

  // The typed text should seed the title input inside the modal.
  const titleInput = connectedPage.getByPlaceholder('Note title');
  await expect(titleInput).toBeVisible({ timeout: 10_000 });
  await expect(titleInput).toHaveValue(sentinel);

  assertNoConsoleErrors(log);
});
