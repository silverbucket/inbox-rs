/**
 * Dropping an image onto an open note joins the two: the note becomes an
 * image card that keeps its id, title and markdown text as the image's notes.
 *
 * Playwright can't drag a file in from the OS, so the drag is dispatched as
 * real DragEvents carrying a DataTransfer with a File, at the visual editor
 * the user actually drops on.
 */

import type { Locator } from '@playwright/test';
import { getInboxItems, putInboxItem } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import { assertNoConsoleErrors, attachConsoleCapture } from '../helpers/pwa';

// 1×1 PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function dispatchFileDrag(target: Locator, type: 'dragover' | 'drop') {
  return target.evaluate(
    (el, { b64, type }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'sketch.png', { type: 'image/png' }));
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { b64: PNG_B64, type },
  );
}

test('dropping an image on a note makes it an image card that keeps the notes', async ({
  connectedPage,
  webOrigin,
  rsUser,
  rsToken,
}) => {
  // An existing, already-synced note with a long write-up — the case this
  // is for. (A note captured seconds ago can still be mid-push, and a write
  // landing then is lost to a remotestoragejs race unrelated to this flow.)
  const title = 'image drop target note';
  const notes = '## Field notes\n\nThe **east** span needs a second look.';
  await putInboxItem(rsUser, rsToken, {
    item: {
      id: `drop-${Date.now()}`,
      type: 'note',
      title,
      body: notes,
      createdAt: new Date().toISOString(),
    },
  });

  const page = connectedPage;
  const log = attachConsoleCapture(page);
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');
  await page
    .getByRole('button', { name: 'Inbox', exact: true })
    .first()
    .click();

  await page.getByRole('button', { name: `Open ${title}` }).click();
  const dialog = page.getByRole('dialog');
  const editor = dialog.locator('.tiptap-editor');
  await expect(editor).toContainText('east span');

  // An edit still inside the autosave debounce when the image lands must
  // ride along on the conversion, not be saved over it.
  const typed = 'unsaved line before the drop';
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(` ${typed}`);

  // Mid-drag the card shows it will take the drop.
  expect(await dispatchFileDrag(editor, 'dragover')).toBe(true);
  await expect(dialog).toHaveClass(/image-drag-over/);

  expect(await dispatchFileDrag(editor, 'drop')).toBe(true);
  await expect(dialog.locator('img.view-image')).toBeVisible({
    timeout: 10_000,
  });
  await expect(dialog).not.toHaveClass(/image-drag-over/);
  await expect(dialog.locator('.tiptap-editor')).toContainText('east span');
  await expect(dialog.locator('.tiptap-editor')).toContainText(typed);

  // One item on the server: the same card, now an image carrying the notes.
  await expect
    .poll(
      async () => {
        const items = await getInboxItems(rsUser, rsToken);
        const item = items.find((i) => i.title === title);
        return (
          item && {
            type: item.type,
            hasNotes:
              'body' in item &&
              !!item.body?.includes('**east** span') &&
              !!item.body?.includes(typed),
            hasFile: 'filePath' in item && !!item.filePath,
          }
        );
      },
      { timeout: 15_000 },
    )
    .toEqual({ type: 'image', hasNotes: true, hasFile: true });

  // ...and stays that way: nothing writes the old note back afterwards.
  await page.waitForTimeout(3_000);
  const after = (await getInboxItems(rsUser, rsToken)).find(
    (i) => i.title === title,
  );
  expect(after?.type).toBe('image');

  assertNoConsoleErrors(log);
});
