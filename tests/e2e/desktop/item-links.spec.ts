/**
 * Links from one item to another: a note can list other items, wherever
 * they live, and each link shows its target's current title.
 *
 * Typing `[[` in a card's Visual editor opens a picker; the pick becomes a
 * chip stored as a plain markdown link to `#/item/<id>`. Clicking the chip
 * opens the target's card, Back returns to the list, and renaming the
 * target renames the chip.
 */

import type { NoteItem } from '@inbox-rs/rs-module';
import type { Page } from '@playwright/test';
import { getInboxItems, putInboxItem } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import {
  assertNoConsoleErrors,
  attachConsoleCapture,
  seedRsSession,
} from '../helpers/pwa';

const LIST: NoteItem = {
  id: 'note-list-1',
  type: 'note',
  title: 'Lisbon trip — everything',
  body: 'Things for the trip:',
  createdAt: '2026-08-03T10:00:00.000Z',
};
const TARGET: NoteItem = {
  id: 'note-target-1',
  type: 'note',
  title: 'Packing list',
  body: 'Passport, charger',
  createdAt: '2026-08-02T10:00:00.000Z',
};
const OTHER: NoteItem = {
  id: 'note-other-1',
  type: 'note',
  title: 'Restaurant ideas',
  body: '',
  createdAt: '2026-08-01T10:00:00.000Z',
};

const dialogTitle = (page: Page) =>
  page.getByRole('dialog').getByRole('textbox', { name: 'Title' });

test('a note links to other items, follows them, and tracks their titles', async ({
  browser,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  for (const item of [LIST, TARGET, OTHER]) {
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

  await page.getByRole('button', { name: `Open ${LIST.title}` }).click();
  const dialog = page.getByRole('dialog');
  const editor = dialog.locator('.tiptap-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+End');

  // `[[` opens the picker; Escape closes the picker and leaves the card.
  const picker = page.getByRole('listbox', { name: 'Link to an item' });
  await page.keyboard.type(' [[', { delay: 20 });
  await expect(picker).toBeVisible();
  // The note being edited is not offered as its own link target.
  await expect(picker.getByRole('option')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(dialog).toBeVisible();

  // Typing narrows the list; Enter links the highlighted item.
  await page.keyboard.type(' [[pack', { delay: 20 });
  await expect(picker.getByRole('option')).toHaveText([/Packing list/]);
  await page.keyboard.press('Enter');
  const chip = editor.locator('a.item-link');
  await expect(chip).toHaveText('Packing list');
  await expect(picker).not.toBeVisible();

  // Stored as a plain markdown link, so other apps still see a link.
  await expect
    .poll(
      async () => {
        const items = await getInboxItems(freshRsUser, freshRsToken);
        const list = items.find((i) => i.id === LIST.id) as NoteItem;
        return list.body;
      },
      { timeout: 15_000 },
    )
    .toContain(`[Packing list](#/item/${TARGET.id})`);

  // Clicking the chip opens the target's card at its own address.
  await chip.click();
  await expect(dialogTitle(page)).toHaveValue(TARGET.title);
  expect(
    context.pages(),
    'the link opens in place, not a new tab',
  ).toHaveLength(1);
  await expect(page).toHaveURL(new RegExp(`#/item/${TARGET.id}$`));

  // Rename the target, go back: the list's chip carries the new title.
  await dialogTitle(page).fill('Packing list (carry-on only)');
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(dialogTitle(page)).toHaveValue(LIST.title);
  await expect(dialog.locator('.tiptap-editor a.item-link')).toHaveText(
    'Packing list (carry-on only)',
  );
  // The Preview tab shows the same live title.
  await dialog.getByRole('button', { name: 'Preview' }).click();
  await expect(dialog.locator('.preview-wrap a.item-link')).toHaveText(
    'Packing list (carry-on only)',
  );

  // Back again closes the list and lands on the page underneath.
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).not.toHaveURL(/#\/item\//);

  assertNoConsoleErrors(log);
  await context.close();
});

test('an item address opens its card directly, and a dead one says so', async ({
  browser,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  await putInboxItem(freshRsUser, freshRsToken, { item: TARGET });
  const context = await browser.newContext();
  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const page = await context.newPage();
  const log = attachConsoleCapture(page);
  // First visit syncs the seeded item down.
  await page.goto(webOrigin);
  await expect(
    page.getByRole('button', { name: `Open ${TARGET.title}` }),
  ).toBeVisible();

  // A cold load of the address, as from a bookmark.
  const direct = await context.newPage();
  await direct.goto(`${webOrigin}/#/item/${TARGET.id}`);
  await expect(dialogTitle(direct)).toHaveValue(TARGET.title);
  await direct.keyboard.press('Escape');
  await expect(direct.getByRole('dialog')).not.toBeVisible();
  await expect(direct).not.toHaveURL(/#\/item\//);

  const dead = await context.newPage();
  await dead.goto(`${webOrigin}/#/item/no-such-item`);
  await expect(dead.getByText('That item no longer exists.')).toBeVisible();
  await expect(dead.getByRole('dialog')).not.toBeVisible();
  await expect(dead).not.toHaveURL(/#\/item\//);

  assertNoConsoleErrors(log);
  await context.close();
});
