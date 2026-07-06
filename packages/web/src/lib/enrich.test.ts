// @vitest-environment jsdom
import type { BookmarkItem } from '@inbox-rs/rs-module';
import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchLinkMetadata, storeItem, itemsMap } = vi.hoisted(() => {
  const map: Record<string, unknown> = {};
  return {
    fetchLinkMetadata: vi.fn(),
    storeItem: vi.fn().mockResolvedValue(undefined),
    itemsMap: map,
  };
});
vi.mock('./link-metadata', () => ({ fetchLinkMetadata }));
vi.mock('./stores', () => ({
  storeItem,
  // Minimal readable-store stub so `get(items)` resolves synchronously.
  items: {
    subscribe: (run: (value: unknown) => void) => {
      run(itemsMap);
      return () => {};
    },
  },
}));

import {
  applyLinkMetadata,
  bulkEnrichProgress,
  enrichAllBookmarks,
  enrichBookmark,
  needsEnrichment,
} from './enrich';

function bookmark(overrides: Partial<BookmarkItem> = {}): BookmarkItem {
  return {
    id: 'b1',
    type: 'bookmark',
    title: 'https://example.com',
    url: 'https://example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(itemsMap)) delete itemsMap[key];
});

describe('needsEnrichment', () => {
  it('is true while any preview field is missing', () => {
    expect(needsEnrichment(bookmark())).toBe(true);
    expect(needsEnrichment(bookmark({ title: 'Real title' }))).toBe(true);
  });

  it('is false once title, description, image and site name are set', () => {
    expect(
      needsEnrichment(
        bookmark({
          title: 'T',
          description: 'D',
          ogImage: 'https://x/i.png',
          siteName: 'Example',
        }),
      ),
    ).toBe(false);
  });
});

describe('applyLinkMetadata', () => {
  it('fills blank fields and replaces a URL-fallback title', () => {
    const updated = applyLinkMetadata(bookmark(), {
      title: 'Example Site',
      description: 'A site',
      image: 'https://x/og.png',
      siteName: 'Example',
      favicon: 'https://x/f.ico',
    });
    expect(updated).toMatchObject({
      title: 'Example Site',
      description: 'A site',
      ogImage: 'https://x/og.png',
      siteName: 'Example',
      favicon: 'https://x/f.ico',
    });
  });

  it('never overwrites user-provided fields', () => {
    const item = bookmark({
      title: 'My title',
      description: 'my note',
      ogImage: 'https://mine/i.png',
      siteName: 'Mine',
      favicon: '/mine.ico',
    });
    expect(
      applyLinkMetadata(item, {
        title: 'Fetched',
        description: 'fetched',
        image: 'https://theirs/i.png',
        siteName: 'Theirs',
        favicon: '/theirs.ico',
      }),
    ).toBeNull();
  });

  it('does not set ogImage when a local image copy exists', () => {
    const item = bookmark({
      title: 'T',
      description: 'D',
      siteName: 'S',
      filePath: 'files/b1.png',
    });
    expect(applyLinkMetadata(item, { image: 'https://x/i.png' })).toBeNull();
  });

  it('returns null when the metadata adds nothing', () => {
    expect(applyLinkMetadata(bookmark(), {})).toBeNull();
  });
});

describe('enrichBookmark', () => {
  it('stores the enriched item merged against the live copy', async () => {
    const item = bookmark();
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockResolvedValue({ title: 'Example', description: 'd' });

    await expect(enrichBookmark(item)).resolves.toBe('updated');
    expect(storeItem).toHaveBeenCalledOnce();
    expect(storeItem.mock.calls[0][0]).toMatchObject({
      id: 'b1',
      title: 'Example',
      description: 'd',
    });
  });

  it('does not resurrect an item deleted during the fetch', async () => {
    fetchLinkMetadata.mockResolvedValue({ title: 'Example' });
    await expect(enrichBookmark(bookmark())).resolves.toBe('none');
    expect(storeItem).not.toHaveBeenCalled();
  });

  it('respects edits made during the fetch', async () => {
    const item = bookmark();
    itemsMap[item.id] = { ...item, title: 'User renamed' };
    fetchLinkMetadata.mockResolvedValue({ title: 'Fetched', description: 'd' });

    await enrichBookmark(item);
    expect(storeItem.mock.calls[0][0]).toMatchObject({
      title: 'User renamed',
      description: 'd',
    });
  });

  it('skips stale items whose URL changed during the fetch', async () => {
    const item = bookmark();
    itemsMap[item.id] = { ...item, url: 'https://elsewhere.com' };
    fetchLinkMetadata.mockResolvedValue({ title: 'Fetched' });

    await expect(enrichBookmark(item)).resolves.toBe('none');
    expect(storeItem).not.toHaveBeenCalled();
  });

  it('resolves "none" without storing when nothing was found', async () => {
    const item = bookmark();
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockResolvedValue(null);
    await expect(enrichBookmark(item)).resolves.toBe('none');
    expect(storeItem).not.toHaveBeenCalled();
  });

  it('propagates fetch failures so callers can offer a retry', async () => {
    const item = bookmark();
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockRejectedValue(new Error('boom'));
    await expect(enrichBookmark(item)).rejects.toThrow('boom');
  });
});

describe('enrichAllBookmarks', () => {
  it('enriches only bookmarks that still need it and reports a summary', async () => {
    itemsMap.b1 = bookmark({ id: 'b1' });
    itemsMap.b2 = bookmark({
      id: 'b2',
      url: 'https://two.com',
      title: 'Done',
      description: 'D',
      ogImage: 'https://x/i.png',
      siteName: 'S',
    });
    itemsMap.n1 = { id: 'n1', type: 'note', title: 'n', createdAt: '' };
    fetchLinkMetadata.mockResolvedValue({ title: 'Fetched' });

    await expect(enrichAllBookmarks()).resolves.toEqual({
      updated: 1,
      failed: 0,
      total: 1,
    });
    expect(fetchLinkMetadata).toHaveBeenCalledOnce();
    expect(fetchLinkMetadata).toHaveBeenCalledWith('https://example.com');
    // Progress is cleared when the pass finishes.
    expect(get(bulkEnrichProgress)).toBeNull();
  });

  it('counts failures without aborting the rest', async () => {
    itemsMap.b1 = bookmark({ id: 'b1' });
    itemsMap.b2 = bookmark({ id: 'b2', url: 'https://two.com' });
    fetchLinkMetadata
      .mockRejectedValueOnce(new Error('dead link'))
      .mockResolvedValueOnce({ title: 'Fetched', description: 'd' });

    await expect(enrichAllBookmarks()).resolves.toEqual({
      updated: 1,
      failed: 1,
      total: 2,
    });
  });
});
