/**
 * A note written on a link shows on the link's card, wherever the card is.
 *
 * A link's `description` is the page's own summary. Its `body` is what the
 * person added — why they kept it — and it used to be readable only by
 * opening the card. The first line now sits under the link's title in the
 * inbox, on a collection's board, and in its list view.
 */

import type { AppConfig, Collection } from '@inbox-rs/rs-module';
import { ARMADIETTO_ORIGIN, putInboxItem } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';

const NOTE = 'Compare with our pricing page before Friday';
const PAGE_SUMMARY = 'Plans and pricing for teams of every size.';

test('a link shows the first line of its note in the inbox, on the board and in the list', async ({
  connectedPage: page,
  webOrigin,
  rsUser,
  rsToken,
}) => {
  const put = async (path: string, value: object) => {
    const stored = await fetch(
      `${ARMADIETTO_ORIGIN}/storage/${rsUser.username}/inbox/${path}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${rsToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(value),
      },
    );
    expect(stored.ok).toBe(true);
  };

  const config: AppConfig = {
    columnSets: [
      {
        id: 'note-pipeline',
        name: 'Pipeline',
        createdAt: '2026-10-01T09:00:00Z',
        columns: [
          { id: 'unsorted', name: 'Unsorted', color: '#8a8378' },
          { id: 'reading', name: 'Reading', color: '#7c3aed' },
        ],
      },
    ],
  };
  const collection: Collection = {
    id: 'note-research',
    name: 'Pricing research',
    itemIds: ['note-filed'],
    boardSetId: 'note-pipeline',
    createdAt: '2026-10-01T09:00:00Z',
  };
  await put('config/app', config);
  await put(`collections/${collection.id}`, collection);
  await putInboxItem(rsUser, rsToken, {
    item: {
      id: 'note-inbox',
      type: 'bookmark',
      title: 'Acme pricing',
      url: 'https://acme.example/pricing',
      description: PAGE_SUMMARY,
      body: `**${NOTE}**\n\nThe enterprise tier is new.`,
      createdAt: '2026-10-02T09:00:00Z',
    },
  });
  await putInboxItem(rsUser, rsToken, {
    item: {
      id: 'note-plain',
      type: 'bookmark',
      title: 'Acme changelog',
      url: 'https://acme.example/changelog',
      description: PAGE_SUMMARY,
      createdAt: '2026-10-02T09:00:00Z',
    },
  });
  await putInboxItem(rsUser, rsToken, {
    item: {
      id: 'note-filed',
      type: 'bookmark',
      title: 'Rival pricing',
      url: 'https://rival.example/pricing',
      description: PAGE_SUMMARY,
      body: `${NOTE}\nSecond line stays inside the card.`,
      collectionId: collection.id,
      createdAt: '2026-10-02T09:00:00Z',
    },
  });

  // Inbox: the note's first line, as plain text, takes the description's place.
  await page.goto(webOrigin);
  const noted = page.locator('[data-item-id="note-inbox"]');
  await expect(noted.getByText(NOTE, { exact: true })).toBeVisible();
  await expect(noted).not.toContainText('enterprise tier');
  await expect(noted).not.toContainText(PAGE_SUMMARY);
  // A link without a note still shows what the page says about itself.
  await expect(page.locator('[data-item-id="note-plain"]')).toContainText(
    PAGE_SUMMARY,
  );

  // Board: the note sits on the card, under the link's title.
  await page.goto(`${webOrigin}/#/collection/${collection.id}`);
  const dialog = page.getByRole('dialog', { name: collection.name });
  const boardCard = dialog.locator('li.card', { hasText: 'Rival pricing' });
  await expect(boardCard.getByText(NOTE, { exact: true })).toBeVisible();
  await expect(boardCard).not.toContainText('Second line');

  // List: the same line, on the link's row.
  await dialog.getByRole('button', { name: 'List', exact: true }).click();
  const row = dialog.locator('li.row', { hasText: 'Rival pricing' });
  const rowNote = row.getByText(NOTE, { exact: true });
  await expect(rowNote).toBeVisible();
  // Under the title, not beside it, so the two never share the row's width.
  const titleBox = await row.getByText('Rival pricing').boundingBox();
  const noteBox = await rowNote.boundingBox();
  // Past the title's middle: boxes on one line would share a top edge, and
  // comparing against the bottom edge trips on sub-pixel rounding.
  expect(noteBox?.y).toBeGreaterThan(
    (titleBox?.y ?? 0) + (titleBox?.height ?? 0) / 2,
  );
});
