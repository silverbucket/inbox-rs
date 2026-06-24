/**
 * Smoke-level CRUD: add a Note via the inbox capture bar, see it surface in
 * the grid.
 *
 * The capture bar auto-detects type: plain text typed + Enter becomes a Note
 * (a single URL would become a Bookmark). This exercises the capture →
 * detect → build → store → grid-render path that every quick capture rides on.
 */

import { expect, test } from '../helpers/fixtures';
import { assertNoConsoleErrors, attachConsoleCapture } from '../helpers/pwa';

test('adding a note via the capture bar surfaces it in the inbox grid', async ({
  connectedPage,
  webOrigin,
}) => {
  const log = attachConsoleCapture(connectedPage);
  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');

  // Make sure we're on the inbox view; the test seed account is empty.
  await connectedPage.getByRole('button', { name: 'Inbox' }).first().click();

  // The desktop capture bar is a single text input. Multi-word plain text is
  // detected as a Note; Enter saves it instantly (no modal). The sentinel is
  // dotless so it can't be mistaken for a bare-domain bookmark.
  const sentinel = 'playwright smoke note alpha';
  const input = connectedPage.getByPlaceholder(
    'Paste a link, jot a note, or drop a file…',
  );
  await input.click();
  await input.fill(sentinel);
  await input.press('Enter');

  // The new note's title (derived from its body) renders in the grid.
  await expect(connectedPage.getByText(sentinel)).toBeVisible({
    timeout: 10_000,
  });

  assertNoConsoleErrors(log);
});
