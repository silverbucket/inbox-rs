import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock browser APIs (vi.hoisted ensures these are available when vi.mock factory runs) ---
const { mockSendMessage, mockFetch } = vi.hoisted(() => {
  const mockSendMessage = vi.fn();
  const mockFetch = vi.fn();
  return { mockSendMessage, mockFetch };
});

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { sendMessage: mockSendMessage },
    storage: { local: { get: vi.fn(), set: vi.fn() } },
  },
}));

vi.stubGlobal('fetch', mockFetch);

import { isImageUrl, isDirectImagePage, saveAsImage, saveAsBookmark } from './save-logic';
import { DirectRS } from '../lib/rs';

function makeRS() {
  return new DirectRS({
    userAddress: 'test@example.com',
    token: 'test-token',
    href: 'https://storage.example.com',
  });
}

describe('isImageUrl', () => {
  it('detects common image extensions', () => {
    expect(isImageUrl('https://example.com/photo.jpg')).toBe(true);
    expect(isImageUrl('https://example.com/photo.jpeg')).toBe(true);
    expect(isImageUrl('https://example.com/photo.png')).toBe(true);
    expect(isImageUrl('https://example.com/photo.gif')).toBe(true);
    expect(isImageUrl('https://example.com/photo.webp')).toBe(true);
    expect(isImageUrl('https://example.com/photo.avif')).toBe(true);
    expect(isImageUrl('https://example.com/photo.svg')).toBe(true);
    expect(isImageUrl('https://example.com/photo.bmp')).toBe(true);
    expect(isImageUrl('https://example.com/photo.tif')).toBe(true);
    expect(isImageUrl('https://example.com/photo.tiff')).toBe(true);
  });

  it('handles URLs with query strings', () => {
    expect(isImageUrl('https://example.com/photo.jpg?w=800')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isImageUrl('https://example.com/photo.JPG')).toBe(true);
    expect(isImageUrl('https://example.com/photo.PNG')).toBe(true);
  });

  it('rejects non-image URLs', () => {
    expect(isImageUrl('https://example.com/page.html')).toBe(false);
    expect(isImageUrl('https://example.com/doc.pdf')).toBe(false);
    expect(isImageUrl('https://example.com/')).toBe(false);
    expect(isImageUrl('https://example.com/article')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isImageUrl('not a url')).toBe(false);
    expect(isImageUrl('')).toBe(false);
  });
});

describe('isDirectImagePage', () => {
  it('returns true when contentType is an image MIME type', () => {
    expect(isDirectImagePage('image/jpeg', 'https://example.com/page')).toBe(true);
    expect(isDirectImagePage('image/png', 'https://example.com/')).toBe(true);
    expect(isDirectImagePage('image/webp', 'https://example.com/')).toBe(true);
  });

  it('returns true when URL has image extension (fallback)', () => {
    expect(isDirectImagePage(undefined, 'https://example.com/photo.jpg')).toBe(true);
    expect(isDirectImagePage('text/html', 'https://example.com/photo.png')).toBe(true);
  });

  it('returns false for non-image pages', () => {
    expect(isDirectImagePage('text/html', 'https://example.com/article')).toBe(false);
    expect(isDirectImagePage(undefined, 'https://example.com/')).toBe(false);
  });
});

describe('saveAsImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads image and creates ImageItem', async () => {
    mockSendMessage.mockResolvedValue({ ok: true, mimeType: 'image/jpeg' });
    mockFetch.mockResolvedValue({ ok: true }); // rs.store -> storeObject

    const rs = makeRS();
    const result = await saveAsImage({
      rs,
      id: 'img-123',
      pageUrl: 'https://cdn.example.com/photo.jpg',
      pageTitle: '',
      pageNote: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result).not.toBeNull();
    expect(result!.type).toBe('image');
    expect(result!.filePath).toBe('files/img-123.jpg');
    expect(result!.mimeType).toBe('image/jpeg');
    expect(result!.sourceUrl).toBe('https://cdn.example.com/photo.jpg');

    expect(mockSendMessage).toHaveBeenCalledWith({
      type: 'download-and-store-image',
      url: 'https://cdn.example.com/photo.jpg',
      filePath: 'files/img-123.jpg',
    });
  });

  it('uses filename from URL as title when pageTitle is empty', async () => {
    mockSendMessage.mockResolvedValue({ ok: true, mimeType: 'image/png' });
    mockFetch.mockResolvedValue({ ok: true });

    const rs = makeRS();
    const result = await saveAsImage({
      rs,
      id: 'img-456',
      pageUrl: 'https://cdn.example.com/uploads/sunset.png',
      pageTitle: '',
      pageNote: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result!.title).toBe('sunset.png');
  });

  it('includes note as description', async () => {
    mockSendMessage.mockResolvedValue({ ok: true, mimeType: 'image/png' });
    mockFetch.mockResolvedValue({ ok: true });

    const rs = makeRS();
    const result = await saveAsImage({
      rs,
      id: 'img-789',
      pageUrl: 'https://cdn.example.com/photo.png',
      pageTitle: 'Photo',
      pageNote: 'Nice sunset shot',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result!.description).toBe('Nice sunset shot');
  });

  it('returns null when download fails', async () => {
    mockSendMessage.mockResolvedValue({ ok: false });

    const rs = makeRS();
    const result = await saveAsImage({
      rs,
      id: 'img-fail',
      pageUrl: 'https://cdn.example.com/broken.jpg',
      pageTitle: '',
      pageNote: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result).toBeNull();
  });

  it('guesses extension from URL', async () => {
    mockSendMessage.mockResolvedValue({ ok: true, mimeType: 'image/webp' });
    mockFetch.mockResolvedValue({ ok: true });

    const rs = makeRS();
    const result = await saveAsImage({
      rs,
      id: 'img-ext',
      pageUrl: 'https://cdn.example.com/photo.webp',
      pageTitle: 'Photo',
      pageNote: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result!.filePath).toBe('files/img-ext.webp');
  });

  it('defaults to jpg when URL has no image extension', async () => {
    mockSendMessage.mockResolvedValue({ ok: true, mimeType: 'image/jpeg' });
    mockFetch.mockResolvedValue({ ok: true });

    const rs = makeRS();
    const result = await saveAsImage({
      rs,
      id: 'img-noext',
      pageUrl: 'https://cdn.example.com/image/12345',
      pageTitle: 'Photo',
      pageNote: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result!.filePath).toBe('files/img-noext.jpg');
  });
});

describe('saveAsBookmark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseParams = {
    id: 'bm-123',
    pageUrl: 'https://example.com/article',
    pageTitle: 'Great Article',
    pageNote: '',
    pageDescription: 'An interesting read',
    embeddedContent: '',
    tweetImages: [] as string[],
    ogImage: '',
    favicon: 'https://example.com/favicon.ico',
    siteName: 'Example',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('creates a BookmarkItem with metadata', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const rs = makeRS();
    const result = await saveAsBookmark({ rs, ...baseParams });

    expect(result.type).toBe('bookmark');
    expect(result.url).toBe('https://example.com/article');
    expect(result.title).toBe('Great Article');
    expect(result.description).toBe('An interesting read');
    expect(result.favicon).toBe('https://example.com/favicon.ico');
    expect(result.siteName).toBe('Example');
  });

  it('downloads og:image for non-tweet pages', async () => {
    mockSendMessage.mockResolvedValue({ ok: true, mimeType: 'image/jpg' });
    mockFetch.mockResolvedValue({ ok: true });

    const rs = makeRS();
    const result = await saveAsBookmark({
      rs,
      ...baseParams,
      ogImage: 'https://example.com/og-image.jpg',
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'download-and-store-image',
        url: 'https://example.com/og-image.jpg',
      })
    );
    expect(result.filePath).toBeDefined();
    expect(result.ogImage).toBe('https://example.com/og-image.jpg');
  });

  it('downloads tweet image instead of og:image for tweet pages', async () => {
    mockSendMessage.mockResolvedValue({ ok: true, mimeType: 'image/jpg' });
    mockFetch.mockResolvedValue({ ok: true });

    const rs = makeRS();
    await saveAsBookmark({
      rs,
      ...baseParams,
      tweetImages: ['https://pbs.twimg.com/media/abc.jpg'],
      ogImage: 'https://pbs.twimg.com/generic-card.jpg',
      embeddedContent: 'Tweet text here',
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://pbs.twimg.com/media/abc.jpg',
      })
    );
  });

  it('filters out placeholder og:images', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const rs = makeRS();
    const result = await saveAsBookmark({
      rs,
      ...baseParams,
      ogImage: 'https://example.com/default/og-fallback.png',
    });

    expect(result.ogImage).toBeUndefined();
  });

  it('combines page note and og:description', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const rs = makeRS();
    const result = await saveAsBookmark({
      rs,
      ...baseParams,
      pageNote: 'My note',
      pageDescription: 'OG description',
    });

    expect(result.description).toBe('My note\n\nOG description');
  });

  it('includes embedded content as body', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const rs = makeRS();
    const result = await saveAsBookmark({
      rs,
      ...baseParams,
      embeddedContent: 'Tweet text content',
    });

    expect(result.body).toBe('Tweet text content');
  });
});
