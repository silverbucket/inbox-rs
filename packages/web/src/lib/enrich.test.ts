// @vitest-environment jsdom
import type { BookmarkItem } from '@inbox-rs/rs-module';
import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  canDownloadImages,
  downloadLinkImage,
  fetchLinkMetadata,
  storeItem,
  removeFile,
  itemsMap,
  settings,
} = vi.hoisted(() => {
  const map: Record<string, unknown> = {};
  return {
    canDownloadImages: vi.fn(),
    downloadLinkImage: vi.fn(),
    fetchLinkMetadata: vi.fn(),
    removeFile: vi.fn().mockResolvedValue(undefined),
    storeItem: vi.fn().mockResolvedValue(undefined),
    itemsMap: map,
    settings: {} as Record<string, unknown>,
  };
});
vi.mock('./link-metadata', async (importOriginal) => ({
  // Keep the real DEFAULT_SOCKETHUB_ENDPOINT so endpoint-resolution
  // assertions run against the actual default.
  ...(await importOriginal<typeof import('./link-metadata')>()),
  canDownloadImages,
  downloadLinkImage,
  fetchLinkMetadata,
}));
// Minimal readable-store stubs so `get(...)` resolves synchronously.
vi.mock('./stores', () => ({
  updateItem: async (
    id: string,
    update: (c: unknown) => unknown,
    fileData?: ArrayBuffer,
  ) => {
    const next = update(itemsMap[id]);
    if (next) {
      await (fileData ? storeItem(next, fileData) : storeItem(next));
      itemsMap[id] = next;
    }
    return next;
  },
  storeItem,
  removeFile,
  items: {
    subscribe: (run: (value: unknown) => void) => {
      run(itemsMap);
      return () => {};
    },
  },
  userSettings: {
    subscribe: (run: (value: unknown) => void) => {
      run(settings);
      return () => {};
    },
  },
}));

import type { NoteItem } from '@inbox-rs/rs-module';
import {
  applyLinkMetadata,
  bulkEnrichProgress,
  describeLinkPreviewError,
  enrichAllBookmarks,
  enrichBookmark,
  isSavedLink,
  keepBookmarkImage,
  LINK_PREVIEW_ERROR,
  LOCAL_LINK_PREVIEWS_KEY,
  LOCAL_SOCKETHUB_URL_KEY,
  linkNoteUrl,
  needsEnrichment,
  needsLinkPreview,
  noteToBookmark,
  refreshBookmark,
  replaceBookmarkImage,
  resolveSockethubEndpoint,
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
  vi.resetAllMocks();
  storeItem.mockResolvedValue(undefined);
  removeFile.mockResolvedValue(undefined);
  localStorage.clear();
  for (const key of Object.keys(itemsMap)) delete itemsMap[key];
  for (const key of Object.keys(settings)) delete settings[key];
});

describe('local preview settings', () => {
  it('uses a local Sockethub endpoint while disconnected', () => {
    localStorage.setItem(
      LOCAL_SOCKETHUB_URL_KEY,
      'http://localhost:10550/sockethub-http',
    );
    expect(resolveSockethubEndpoint()).toBe(
      'http://localhost:10550/sockethub-http',
    );
  });

  it('honors the local preview toggle', async () => {
    localStorage.setItem(LOCAL_LINK_PREVIEWS_KEY, 'false');
    const item = bookmark();
    itemsMap[item.id] = item;
    await expect(enrichBookmark(item)).resolves.toBe('none');
    expect(fetchLinkMetadata).not.toHaveBeenCalled();
  });

  it('keeps the card message plain; the diagnosis is the detail', () => {
    expect(LINK_PREVIEW_ERROR).toBe('Couldn’t load a preview for this link.');
  });

  it('turns network failures into an actionable diagnosis', () => {
    expect(describeLinkPreviewError(new TypeError('Failed to fetch'))).toBe(
      'Couldn’t reach the preview service. Check its URL, CORS, and that it is running.',
    );
    expect(describeLinkPreviewError(new Error('404 Not Found'))).toBe(
      'Preview service error: 404 Not Found',
    );
  });
});

describe('saved link helpers', () => {
  const url = 'https://example.com/page';
  const linkNote = (overrides: Partial<NoteItem> = {}): NoteItem => ({
    id: 'n1',
    type: 'note',
    title: url.slice(0, 50),
    body: url,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('recognises link-only notes and ignores todos or mixed text', () => {
    expect(linkNoteUrl(linkNote())).toBe(url);
    expect(isSavedLink(linkNote())).toBe(true);
    expect(needsLinkPreview(linkNote())).toBe(true);

    expect(linkNoteUrl(linkNote({ isTodo: true }))).toBeNull();
    expect(isSavedLink(linkNote({ isTodo: true }))).toBe(false);
    expect(needsLinkPreview(linkNote({ isTodo: true }))).toBe(false);

    expect(
      linkNoteUrl(
        linkNote({
          body: 'read https://example.com/page later',
          title: 'read',
        }),
      ),
    ).toBeNull();
    expect(isSavedLink(bookmark())).toBe(true);
    expect(
      needsLinkPreview(
        bookmark({
          title: 'Done',
          description: 'D',
          ogImage: 'https://x/i.png',
          siteName: 'S',
        }),
      ),
    ).toBe(false);
  });

  it('converts a link-only note to a bookmark without clobbering a custom title', () => {
    const note = linkNote({ title: 'My bookmark label' });
    expect(noteToBookmark(note, url)).toEqual({
      id: 'n1',
      type: 'bookmark',
      title: 'My bookmark label',
      url,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(noteToBookmark(linkNote(), url).title).toBe(url);
  });

  it('treats a cut-off derived title, with or without "…", as a fallback', () => {
    const long = `https://example.com/${'a'.repeat(60)}`;
    for (const title of [`${long.slice(0, 50)}…`, long.slice(0, 50)]) {
      expect(noteToBookmark(linkNote({ title, body: long }), long).title).toBe(
        long,
      );
    }
  });
});

describe('needsEnrichment', () => {
  it('is true while any preview field is missing', () => {
    expect(needsEnrichment(bookmark())).toBe(true);
    expect(needsEnrichment(bookmark({ title: 'Real title' }))).toBe(true);
  });

  it('is true while the image is only a share card', () => {
    expect(
      needsEnrichment(
        bookmark({
          title: 'T',
          description: 'D',
          ogImage: 'https://share.redd.it/preview/post/1xlli1q',
          siteName: 'reddit',
        }),
      ),
    ).toBe(true);
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

  it('replaces a title that is only the site name', () => {
    const item = bookmark({
      title: 'reddit',
      url: 'https://www.reddit.com/r/hockey/comments/abc/a_post/',
    });
    expect(
      needsEnrichment({
        ...item,
        description: 'D',
        siteName: 'reddit',
        ogImage: 'https://x/i.png',
      }),
    ).toBe(true);
    expect(applyLinkMetadata(item, { title: 'A post' })?.title).toBe('A post');
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

  it('replaces a stored Reddit share card and its local copy', () => {
    const item = bookmark({
      title: 'T',
      description: 'D',
      siteName: 'reddit',
      ogImage: 'https://share.redd.it/preview/post/1xlli1q',
      filePath: 'files/b1.jpg',
      mimeType: 'image/png',
    });
    const updated = applyLinkMetadata(item, {
      image: 'https://i.redd.it/g6oz7p3e14zh1.jpeg',
    });
    expect(updated?.ogImage).toBe('https://i.redd.it/g6oz7p3e14zh1.jpeg');
    expect(updated?.filePath).toBeUndefined();
    expect(updated?.mimeType).toBeUndefined();
  });

  it('replaces a stored Amazon share icon', () => {
    const item = bookmark({
      ogImage:
        'https://m.media-amazon.com/images/G/01/share-icons/previewdoh/amazon.png',
    });
    expect(
      applyLinkMetadata(item, {
        image: 'https://m.media-amazon.com/images/I/81abc.jpg',
      })?.ogImage,
    ).toBe('https://m.media-amazon.com/images/I/81abc.jpg');
  });

  it('never stores a fetched placeholder image', () => {
    expect(
      applyLinkMetadata(bookmark(), {
        image: 'https://share.redd.it/preview/post/1xlli1q',
      }),
    ).toBeNull();
  });

  it('returns null when the metadata adds nothing', () => {
    expect(applyLinkMetadata(bookmark(), {})).toBeNull();
  });

  it('schedules an unscheduled bookmark from the page event', () => {
    const updated = applyLinkMetadata(bookmark(), {
      event: {
        name: 'Tech Talks',
        startDate: '2026-11-09T18:00:00-06:00',
        endDate: '2026-11-09T20:00:00-06:00',
        location: 'Austin, TX',
      },
    });
    expect(updated).toMatchObject({
      scheduleKind: 'event',
      startsAt: '2026-11-10T00:00:00.000Z',
      endsAt: '2026-11-10T02:00:00.000Z',
      location: 'Austin, TX',
    });
    expect(updated?.allDay).toBeUndefined();
  });

  it('titles a URL-titled bookmark from the event name when the page has none', () => {
    const updated = applyLinkMetadata(bookmark(), {
      event: { name: 'Tech Talks', startDate: '2026-11-09T18:00:00Z' },
    });
    expect(updated?.title).toBe('Tech Talks');
    expect(
      applyLinkMetadata(bookmark(), {
        title: 'Page',
        event: { name: 'Tech Talks', startDate: '2026-11-09T18:00:00Z' },
      })?.title,
    ).toBe('Page');
  });

  it('treats a date-only event start as all-day on that local date', () => {
    const updated = applyLinkMetadata(bookmark(), {
      event: { name: 'Conf', startDate: '2026-11-09' },
    });
    expect(updated?.allDay).toBe(true);
    expect(updated?.startsAt).toBe(new Date(2026, 10, 9).toISOString());
  });

  it('keeps a date-only span, its endDate taken as the inclusive last day', () => {
    const updated = applyLinkMetadata(bookmark(), {
      event: { name: 'Conf', startDate: '2026-11-09', endDate: '2026-11-11' },
    });
    expect(updated?.allDay).toBe(true);
    expect(updated?.endsAt).toBe(new Date(2026, 10, 11).toISOString());
  });

  it('never overrides a time the user already set', () => {
    const item = bookmark({
      title: 'T',
      description: 'D',
      ogImage: 'i',
      siteName: 'S',
      favicon: 'f',
      location: 'Here',
      startsAt: '2026-01-01T10:00:00.000Z',
      scheduleKind: 'task',
    });
    expect(
      applyLinkMetadata(item, {
        event: { name: 'E', startDate: '2026-11-09T18:00:00Z', location: 'X' },
      }),
    ).toBeNull();
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

  it('deletes the local copy of a replaced share card', async () => {
    const item = bookmark({
      ogImage: 'https://share.redd.it/preview/post/1xlli1q',
      filePath: 'files/b1.jpg',
      mimeType: 'image/png',
    });
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockResolvedValue({
      image: 'https://i.redd.it/g6oz7p3e14zh1.jpeg',
    });

    await expect(enrichBookmark(item)).resolves.toBe('updated');
    expect(removeFile).toHaveBeenCalledWith('files/b1.jpg');
  });

  it('is a no-op when the user disabled link previews', async () => {
    settings.linkPreviews = false;
    const item = bookmark();
    itemsMap[item.id] = item;
    await expect(enrichBookmark(item)).resolves.toBe('none');
    expect(fetchLinkMetadata).not.toHaveBeenCalled();
  });

  it('uses the default endpoint unless the user configured their own', async () => {
    const item = bookmark();
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockResolvedValue(null);

    await enrichBookmark(item);
    expect(fetchLinkMetadata).toHaveBeenLastCalledWith(
      item.url,
      'https://sockethub.silverbucket.net/sockethub-http',
    );

    settings.sockethubUrl = 'https://my.sockethub/sockethub-http';
    await enrichBookmark(item);
    expect(fetchLinkMetadata).toHaveBeenLastCalledWith(
      item.url,
      'https://my.sockethub/sockethub-http',
    );
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

describe('refreshBookmark', () => {
  const complete = () =>
    bookmark({
      title: 'My title',
      description: 'D',
      siteName: 'X',
      ogImage: 'https://abs.twimg.com/generic-card.png',
      filePath: 'files/b1.png',
      mimeType: 'image/png',
    });

  it('offers a different image without replacing the saved one', async () => {
    const item = complete();
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockResolvedValue({
      title: 'Their title',
      image: 'https://pbs.twimg.com/media/real.jpg',
    });

    await expect(refreshBookmark(item)).resolves.toEqual({
      status: 'none',
      image: 'https://pbs.twimg.com/media/real.jpg',
    });
    expect(storeItem).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
    expect(itemsMap[item.id]).toBe(item);
  });

  it('offers nothing when the page still has the saved image', async () => {
    const item = complete();
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockResolvedValue({
      image: 'https://abs.twimg.com/generic-card.png',
    });

    await expect(refreshBookmark(item)).resolves.toEqual({ status: 'none' });
  });

  it('never offers a share card in place of a saved image', async () => {
    const item = complete();
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockResolvedValue({
      image: 'https://share.redd.it/preview/post/1xlli1q',
    });

    await expect(refreshBookmark(item)).resolves.toEqual({ status: 'none' });
  });

  it('offers nothing for an image it has just filled in', async () => {
    const item = bookmark();
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockResolvedValue({ image: 'https://x/og.png' });

    await expect(refreshBookmark(item)).resolves.toEqual({ status: 'updated' });
  });

  it('leaves the bookmark alone when the link is dead', async () => {
    const item = complete();
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockRejectedValue(new Error('404'));

    await expect(refreshBookmark(item)).rejects.toThrow('404');
    expect(storeItem).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });
});

describe('refreshBookmark without a reply', () => {
  it('reports a skipped check, not an unchanged page', async () => {
    const item = bookmark({ title: 'T' });
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockResolvedValue(null);

    await expect(refreshBookmark(item)).resolves.toEqual({ status: 'skipped' });
    await expect(enrichBookmark(item)).resolves.toBe('none');
  });
});

/** A downloaded image as the media platform client returns it. */
function downloaded(mimeType = 'image/jpeg') {
  return {
    url: 'https://cdn/final',
    mimeType,
    data: new Uint8Array([1, 2, 3]).buffer,
  };
}

describe('keepBookmarkImage', () => {
  it('stores the preview image next to the bookmark', async () => {
    const item = bookmark({ ogImage: 'https://cdn/hero' });
    itemsMap[item.id] = item;
    canDownloadImages.mockResolvedValue(true);
    downloadLinkImage.mockResolvedValue(downloaded('image/webp'));

    await expect(keepBookmarkImage(item)).resolves.toBe(true);
    expect(downloadLinkImage).toHaveBeenCalledWith(
      'https://example.com',
      'https://cdn/hero',
      expect.any(String),
    );
    const [stored, data] = storeItem.mock.calls[0];
    expect(stored).toMatchObject({
      ogImage: 'https://cdn/hero',
      filePath: 'files/b1.webp',
      mimeType: 'image/webp',
    });
    expect(new Uint8Array(data)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('leaves a bookmark that already has a copy alone', async () => {
    const item = bookmark({
      ogImage: 'https://cdn/hero',
      filePath: 'files/b1.jpg',
      mimeType: 'image/jpeg',
    });
    await expect(keepBookmarkImage(item)).resolves.toBe(false);
    expect(downloadLinkImage).not.toHaveBeenCalled();
  });

  it('does not keep a placeholder share card', async () => {
    const item = bookmark({ ogImage: 'https://share.redd.it/preview/x' });
    await expect(keepBookmarkImage(item)).resolves.toBe(false);
    expect(canDownloadImages).not.toHaveBeenCalled();
  });

  it('does nothing when the server cannot download images', async () => {
    const item = bookmark({ ogImage: 'https://cdn/hero' });
    itemsMap[item.id] = item;
    canDownloadImages.mockResolvedValue(false);
    await expect(keepBookmarkImage(item)).resolves.toBe(false);
    expect(downloadLinkImage).not.toHaveBeenCalled();
    expect(storeItem).not.toHaveBeenCalled();
  });

  it('drops the download when the image changed meanwhile', async () => {
    const item = bookmark({ ogImage: 'https://cdn/hero' });
    itemsMap[item.id] = { ...item, ogImage: 'https://cdn/other' };
    canDownloadImages.mockResolvedValue(true);
    downloadLinkImage.mockResolvedValue(downloaded());
    await expect(keepBookmarkImage(item)).resolves.toBe(false);
    expect(storeItem).not.toHaveBeenCalled();
  });

  it('skips an image type it has no file extension for', async () => {
    const item = bookmark({ ogImage: 'https://cdn/hero' });
    itemsMap[item.id] = item;
    canDownloadImages.mockResolvedValue(true);
    downloadLinkImage.mockResolvedValue(downloaded('image/tiff'));
    await expect(keepBookmarkImage(item)).resolves.toBe(false);
    expect(storeItem).not.toHaveBeenCalled();
  });
});

describe('refreshBookmark keeping the image', () => {
  it('stores the image the page offers for a new bookmark', async () => {
    const item = bookmark();
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockResolvedValue({
      title: 'Title',
      image: 'https://cdn/hero',
    });
    canDownloadImages.mockResolvedValue(true);
    downloadLinkImage.mockResolvedValue(downloaded());

    await expect(refreshBookmark(item)).resolves.toEqual({ status: 'updated' });
    expect(itemsMap[item.id]).toMatchObject({
      title: 'Title',
      ogImage: 'https://cdn/hero',
      filePath: 'files/b1.jpg',
      mimeType: 'image/jpeg',
    });
  });

  it('keeps the preview when its image cannot be downloaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const item = bookmark();
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockResolvedValue({
      title: 'Title',
      image: 'https://cdn/hero',
    });
    canDownloadImages.mockResolvedValue(true);
    downloadLinkImage.mockRejectedValue(new Error('not-found'));

    await expect(refreshBookmark(item)).resolves.toEqual({ status: 'updated' });
    expect(itemsMap[item.id]).toMatchObject({
      title: 'Title',
      ogImage: 'https://cdn/hero',
    });
    expect((itemsMap[item.id] as BookmarkItem).filePath).toBeUndefined();
    warn.mockRestore();
  });

  it('removes a replaced share card before storing the new image on its path', async () => {
    const item = bookmark({
      ogImage: 'https://share.redd.it/preview/post/abc',
      filePath: 'files/b1.jpg',
      mimeType: 'image/jpeg',
    });
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockResolvedValue({ image: 'https://cdn/real' });
    canDownloadImages.mockResolvedValue(true);
    downloadLinkImage.mockResolvedValue(downloaded());

    await refreshBookmark(item);

    expect((itemsMap[item.id] as BookmarkItem).filePath).toBe('files/b1.jpg');
    expect(removeFile).toHaveBeenCalledTimes(1);
    const storedWithFile = storeItem.mock.calls.findIndex((call) => call[1]);
    expect(removeFile.mock.invocationCallOrder[0]).toBeLessThan(
      storeItem.mock.invocationCallOrder[storedWithFile],
    );
  });

  it('gives an older bookmark its copy even when nothing else is new', async () => {
    const item = bookmark({
      title: 'Done',
      description: 'D',
      siteName: 'S',
      ogImage: 'https://cdn/hero',
    });
    itemsMap[item.id] = item;
    fetchLinkMetadata.mockResolvedValue({ image: 'https://cdn/hero' });
    canDownloadImages.mockResolvedValue(true);
    downloadLinkImage.mockResolvedValue(downloaded());

    await expect(refreshBookmark(item)).resolves.toEqual({ status: 'none' });
    expect((itemsMap[item.id] as BookmarkItem).filePath).toBe('files/b1.jpg');
  });
});

describe('replaceBookmarkImage', () => {
  it('stores a copy of the chosen image and drops the old one', async () => {
    const item = bookmark({
      ogImage: 'https://abs.twimg.com/generic-card.png',
      filePath: 'files/b1.png',
      mimeType: 'image/png',
    });
    itemsMap[item.id] = item;
    canDownloadImages.mockResolvedValue(true);
    downloadLinkImage.mockResolvedValue(downloaded());

    await expect(
      replaceBookmarkImage(item, 'https://pbs.twimg.com/media/real.jpg'),
    ).resolves.toBe('replaced');
    const [stored, data] = storeItem.mock.calls[0];
    expect(stored.ogImage).toBe('https://pbs.twimg.com/media/real.jpg');
    expect(stored.filePath).toBe('files/b1.jpg');
    expect(stored.mimeType).toBe('image/jpeg');
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect(removeFile).toHaveBeenCalledWith('files/b1.png');
  });

  it('overwrites a copy stored under the same path without deleting it', async () => {
    const item = bookmark({
      ogImage: 'https://cdn/old.jpg',
      filePath: 'files/b1.jpg',
      mimeType: 'image/jpeg',
    });
    itemsMap[item.id] = item;
    canDownloadImages.mockResolvedValue(true);
    downloadLinkImage.mockResolvedValue(downloaded());

    await expect(
      replaceBookmarkImage(item, 'https://cdn/new.jpg'),
    ).resolves.toBe('replaced');
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('keeps the saved copy when the new image cannot be downloaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const item = bookmark({
      ogImage: 'https://cdn/old.jpg',
      filePath: 'files/b1.jpg',
      mimeType: 'image/jpeg',
    });
    itemsMap[item.id] = item;
    canDownloadImages.mockResolvedValue(true);
    downloadLinkImage.mockRejectedValue(new Error('origin-refused'));

    await expect(
      replaceBookmarkImage(item, 'https://cdn/new.jpg'),
    ).resolves.toBe('kept');
    expect(storeItem).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps the saved copy when the server cannot download images', async () => {
    const item = bookmark({
      ogImage: 'https://cdn/old.jpg',
      filePath: 'files/b1.jpg',
      mimeType: 'image/jpeg',
    });
    itemsMap[item.id] = item;
    canDownloadImages.mockResolvedValue(false);

    await expect(
      replaceBookmarkImage(item, 'https://cdn/new.jpg'),
    ).resolves.toBe('kept');
    expect(storeItem).not.toHaveBeenCalled();
  });

  it('swaps the link when there was no saved copy to lose', async () => {
    const item = bookmark({ ogImage: 'https://cdn/old.jpg' });
    itemsMap[item.id] = item;
    canDownloadImages.mockResolvedValue(false);

    await expect(
      replaceBookmarkImage(item, 'https://cdn/new.jpg'),
    ).resolves.toBe('replaced');
    expect(storeItem.mock.calls[0][0].ogImage).toBe('https://cdn/new.jpg');
  });

  it('does nothing when the bookmark vanished meanwhile', async () => {
    canDownloadImages.mockResolvedValue(false);
    await expect(
      replaceBookmarkImage(bookmark(), 'https://x/new.png'),
    ).resolves.toBe('gone');
    expect(storeItem).not.toHaveBeenCalled();
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
    expect(fetchLinkMetadata.mock.calls[0][0]).toBe('https://example.com');
    // Progress is cleared when the pass finishes.
    expect(get(bulkEnrichProgress)).toBeNull();
  });

  it('converts link-only notes into bookmarks and fetches their previews', async () => {
    // How quick-capture and the share target save links: a note whose
    // body is nothing but the URL.
    const url = 'https://x.com/jack/status/20';
    itemsMap.n1 = {
      id: 'n1',
      type: 'note',
      title: url.slice(0, 50),
      body: url,
      createdAt: '',
    };
    itemsMap.n2 = {
      id: 'n2',
      type: 'note',
      title: 'Shopping',
      body: 'milk https://example.com eggs',
      createdAt: '',
    };
    fetchLinkMetadata.mockResolvedValue({ title: 'Fetched' });

    await expect(enrichAllBookmarks()).resolves.toEqual({
      updated: 1,
      failed: 0,
      total: 1,
    });
    expect(storeItem).toHaveBeenCalledWith({
      id: 'n1',
      type: 'bookmark',
      title: url,
      url,
      createdAt: '',
    });
    expect(fetchLinkMetadata).toHaveBeenCalledOnce();
    expect(fetchLinkMetadata.mock.calls[0][0]).toBe(url);
    // The fetched metadata lands on the converted bookmark, not the note.
    expect(storeItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'n1', type: 'bookmark', title: 'Fetched' }),
    );
  });

  it('does not convert a link note that changed or vanished while queued', async () => {
    // Three bookmarks fill the worker slots, so the notes wait; by the time
    // a worker reaches them, a sync has deleted one and edited the other.
    const url = 'https://x.com/jack/status/20';
    for (const id of ['b1', 'b2', 'b3']) {
      itemsMap[id] = bookmark({
        id,
        url: `https://${id}.com`,
        title: `https://${id}.com`,
      });
    }
    const note = {
      id: 'n1',
      type: 'note',
      title: url,
      body: url,
      createdAt: '',
    };
    itemsMap.n1 = note;
    itemsMap.n2 = { ...note, id: 'n2' };
    fetchLinkMetadata.mockImplementation(async () => {
      delete itemsMap.n1;
      itemsMap.n2 = { ...note, id: 'n2', body: 'now some text' };
      return { title: 'Fetched' };
    });

    await expect(enrichAllBookmarks()).resolves.toEqual({
      updated: 3,
      failed: 0,
      total: 5,
    });
    const stored = storeItem.mock.calls.map((c) => c[0].id);
    expect(stored).not.toContain('n1');
    expect(stored).not.toContain('n2');
    expect(fetchLinkMetadata).toHaveBeenCalledTimes(3);
    expect(get(bulkEnrichProgress)).toBeNull();
  });

  it('counts failures without aborting the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    itemsMap.b1 = bookmark({ id: 'b1' });
    itemsMap.b2 = bookmark({ id: 'b2', url: 'https://two.com' });
    const deadLink = new Error('dead link');
    fetchLinkMetadata
      .mockRejectedValueOnce(deadLink)
      .mockResolvedValueOnce({ title: 'Fetched', description: 'd' });

    await expect(enrichAllBookmarks()).resolves.toEqual({
      updated: 1,
      failed: 1,
      total: 2,
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      'Link preview enrichment failed:',
      'https://example.com',
      deadLink,
    );
    warn.mockRestore();
  });

  it('counts a failed store as a failure too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    itemsMap.b1 = bookmark({ id: 'b1' });
    fetchLinkMetadata.mockResolvedValueOnce({ title: 'Fetched' });
    const storeFailed = new Error('Inbox storage module is not available');
    storeItem.mockRejectedValueOnce(storeFailed);

    await expect(enrichAllBookmarks()).resolves.toEqual({
      updated: 0,
      failed: 1,
      total: 1,
    });
    expect(warn).toHaveBeenCalledWith(
      'Link preview enrichment failed:',
      'https://example.com',
      storeFailed,
    );
    warn.mockRestore();
  });
});
