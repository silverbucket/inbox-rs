// @vitest-environment jsdom
import type { BookmarkItem, InboxItem } from '@inbox-rs/rs-module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { downloadDirectImage, storeItem, itemValues, items } = vi.hoisted(() => {
  let itemValues: Record<string, InboxItem> = {};
  return {
    downloadDirectImage: vi.fn(),
    storeItem: vi.fn().mockResolvedValue(undefined),
    itemValues: {
      set(value: Record<string, InboxItem>) {
        itemValues = value;
      },
    },
    items: {
      subscribe(run: (value: Record<string, InboxItem>) => void) {
        run(itemValues);
        return () => {};
      },
    },
  };
});

vi.mock('./direct-image', () => ({ downloadDirectImage }));
vi.mock('./stores', () => ({ items, storeItem }));

import { convertBookmarkToImage } from './bookmark-image';

const bookmark: BookmarkItem = {
  id: 'bookmark-1',
  type: 'bookmark',
  title: 'Photo',
  description: 'A description',
  body: '**Markdown** notes',
  url: 'https://example.com/photo',
  favicon: 'https://example.com/favicon.ico',
  ogImage: 'https://example.com/preview.jpg',
  siteName: 'Example',
  collectionId: 'collection-1',
  pinned: true,
  startsAt: '2026-08-27T10:00:00.000Z',
  createdAt: '2026-08-26T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  itemValues.set({ [bookmark.id]: bookmark });
});

describe('convertBookmarkToImage', () => {
  it('converts a direct image bookmark and retains its user metadata', async () => {
    downloadDirectImage.mockResolvedValue(
      new File([new Uint8Array([1, 2, 3])], 'photo.jpg', {
        type: 'image/jpeg',
      }),
    );

    await expect(convertBookmarkToImage(bookmark)).resolves.toBe(true);

    expect(downloadDirectImage).toHaveBeenCalledWith(bookmark.url);
    const converted = storeItem.mock.calls[0][0] as Record<string, unknown>;
    expect(converted).toMatchObject({
      id: bookmark.id,
      type: 'image',
      title: bookmark.title,
      description: bookmark.description,
      body: bookmark.body,
      sourceUrl: bookmark.url,
      collectionId: bookmark.collectionId,
      pinned: true,
      startsAt: bookmark.startsAt,
      mimeType: 'image/jpeg',
    });
    expect(converted).not.toHaveProperty('url');
    expect(converted).not.toHaveProperty('favicon');
    expect(converted).not.toHaveProperty('ogImage');
    expect(converted).not.toHaveProperty('siteName');
    expect(storeItem.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer);
  });

  it('keeps a normal bookmark unchanged', async () => {
    downloadDirectImage.mockResolvedValue(null);

    await expect(convertBookmarkToImage(bookmark)).resolves.toBe(false);
    expect(storeItem).not.toHaveBeenCalled();
  });

  it('does not overwrite a bookmark changed during the image download', async () => {
    downloadDirectImage.mockImplementation(async () => {
      itemValues.set({
        [bookmark.id]: { ...bookmark, url: 'https://example.com/new-url' },
      });
      return new File(['image'], 'photo.jpg', { type: 'image/jpeg' });
    });

    await expect(convertBookmarkToImage(bookmark)).resolves.toBe(false);
    expect(storeItem).not.toHaveBeenCalled();
  });
});
