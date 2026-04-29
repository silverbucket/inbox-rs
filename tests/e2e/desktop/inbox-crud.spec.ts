/**
 * Smoke-level CRUD: add a Note via the UI, see it surface in the grid.
 *
 * Bookmarks/images/audio depend on the user dropping a URL or picking a
 * file — which is where the UI gets noisy and isn't a great fit for an
 * end-to-end smoke test. Notes are pure-text and exercise the Add Entry
 * modal, the markdown editor, and the change-event → grid render path,
 * which is the same plumbing every other type rides on.
 */

import { expect, test } from '../helpers/fixtures';
import { assertNoConsoleErrors, attachConsoleCapture } from '../helpers/pwa';

test('adding a note via the UI surfaces it in the inbox grid', async ({
  connectedPage,
  webOrigin,
}) => {
  const log = attachConsoleCapture(connectedPage);
  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');

  // Make sure we're on the inbox view; the test seed account is empty.
  await connectedPage.getByRole('button', { name: 'Inbox' }).first().click();

  // Open the Add Note modal from the strip (`AddEntryBar.svelte`). The
  // button's accessible name flips between "Note" (visible-text wins on
  // desktop) and "Add Note" (text hidden under the 520 px CSS, title
  // takes over) — so we anchor on the stable `title` attribute.
  await connectedPage.locator('button[title="Add Note"]').click();

  // AddEntryModal mounts a TipTap editor — a contenteditable ProseMirror
  // node with `role="textbox"`. Type some unique text we can search for
  // in the grid afterwards.
  const sentinel = 'playwright-smoke-note-α';
  const editor = connectedPage.locator('[contenteditable="true"]').first();
  await editor.click();
  await editor.type(sentinel);

  // The modal's primary action is labelled "Save" or "Add" depending on
  // whether we're editing — for a new note it's "Add".
  await connectedPage
    .getByRole('button', { name: /^(Add|Save)$/ })
    .first()
    .click();

  // Wait for the modal to close (sentinel is no longer inside an aria
  // dialog) and the new card to render in the grid.
  await expect(connectedPage.getByText(sentinel)).toBeVisible({
    timeout: 10_000,
  });

  assertNoConsoleErrors(log);
});
