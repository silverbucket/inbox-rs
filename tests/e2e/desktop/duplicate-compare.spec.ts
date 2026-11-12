import type { Collection } from '@inbox-rs/rs-module';
import { ARMADIETTO_ORIGIN, putInboxItem } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';

test('the duplicate hint opens both copies, and keeping one archives the other', async ({
  connectedPage: page,
  webOrigin,
  rsUser,
  rsToken,
}) => {
  const url = 'https://example.com/duplicate-compare';
  const collection: Collection = {
    id: 'dup-reading',
    name: 'Reading List',
    itemIds: ['dup-filed'],
    createdAt: new Date().toISOString(),
  };
  const stored = await fetch(
    `${ARMADIETTO_ORIGIN}/storage/${rsUser.username}/inbox/collections/${collection.id}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${rsToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(collection),
    },
  );
  expect(stored.ok).toBe(true);
  await putInboxItem(rsUser, rsToken, {
    item: {
      id: 'dup-filed',
      type: 'bookmark',
      title: 'How to compare things',
      url,
      notes: 'Read before Friday',
      collectionId: collection.id,
      createdAt: '2026-10-01T09:00:00Z',
    },
  });
  await putInboxItem(rsUser, rsToken, {
    item: {
      id: 'dup-inbox',
      type: 'bookmark',
      title: 'How to compare things',
      url: `${url}/`,
      createdAt: new Date().toISOString(),
    },
  });
  await page.goto(webOrigin);

  // The inbox card repeats a filed bookmark, and says where that one is.
  const card = page.locator('[data-item-id="dup-inbox"]');
  const hint = card.getByRole('button', {
    name: 'Already in Reading List — compare?',
  });
  await hint.click();

  const dialog = page.getByRole('dialog', {
    name: 'Two copies of the same card',
  });
  await expect(dialog.locator('[data-item-id="dup-inbox"]')).toBeVisible();
  await expect(dialog.locator('[data-item-id="dup-filed"]')).toBeVisible();
  const inboxCopy = dialog.getByRole('region', { name: 'Copy 1: Inbox' });
  const filedCopy = dialog.getByRole('region', {
    name: 'Copy 2: Reading List',
  });
  // Only the filed copy has notes, and the row says so on both sides.
  await expect(filedCopy.locator('[data-fact="notes"]')).toContainText(
    'Read before Friday',
  );
  await expect(inboxCopy.locator('[data-fact="notes"]')).toHaveClass(/differs/);
  await expect(inboxCopy.locator('[data-fact="title"]')).not.toHaveClass(
    /differs/,
  );

  // Closing changes nothing.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await hint.click();

  await inboxCopy.getByRole('button', { name: 'Keep this one' }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toBeVisible();
  await expect(hint).toBeHidden();
  const toast = page.getByRole('status').filter({
    hasText: 'Archived the other copy',
  });
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(hint).toBeVisible();
});
