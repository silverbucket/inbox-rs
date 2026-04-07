import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock browser APIs (vi.hoisted ensures availability during vi.mock factory) ---
const {
  onInstalledListeners,
  onClickedListeners,
  onMessageListeners,
  mockContextMenusCreate,
  mockTabsSendMessage,
  mockStorageGet,
  mockFetch,
} = vi.hoisted(() => {
  const onInstalledListeners: Function[] = [];
  const onClickedListeners: Function[] = [];
  const onMessageListeners: Function[] = [];
  return {
    onInstalledListeners,
    onClickedListeners,
    onMessageListeners,
    mockContextMenusCreate: vi.fn(),
    mockTabsSendMessage: vi.fn(),
    mockStorageGet: vi.fn(),
    mockFetch: vi.fn(),
  };
});

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      onInstalled: { addListener: (fn: Function) => onInstalledListeners.push(fn) },
      onMessage: { addListener: (fn: Function) => onMessageListeners.push(fn) },
    },
    contextMenus: {
      create: mockContextMenusCreate,
      onClicked: { addListener: (fn: Function) => onClickedListeners.push(fn) },
    },
    tabs: {
      sendMessage: mockTabsSendMessage,
    },
    storage: {
      local: { get: mockStorageGet },
    },
  },
}));

vi.stubGlobal('fetch', mockFetch);
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });

// Import the service worker (triggers listener registration)
await import('./service-worker');

function stubConfig() {
  mockStorageGet.mockResolvedValue({
    'inbox-rs-config': {
      userAddress: 'test@example.com',
      token: 'test-token',
      href: 'https://storage.example.com',
    },
  });
}

describe('service-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubConfig();
  });

  describe('context menu registration', () => {
    it('registers save-link, save-image, and save-selection menus on install', () => {
      for (const listener of onInstalledListeners) listener();

      expect(mockContextMenusCreate).toHaveBeenCalledTimes(3);
      expect(mockContextMenusCreate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'save-link', contexts: ['link'] })
      );
      expect(mockContextMenusCreate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'save-image', contexts: ['image'] })
      );
      expect(mockContextMenusCreate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'save-selection', contexts: ['selection'] })
      );
    });
  });

  describe('context menu: save-image', () => {
    it('downloads the image and stores as ImageItem', async () => {
      const imageBuffer = new ArrayBuffer(100);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'image/jpeg' }),
          arrayBuffer: () => Promise.resolve(imageBuffer),
        })
        .mockResolvedValueOnce({ ok: true }) // storeFile PUT
        .mockResolvedValueOnce({ ok: true }); // storeObject PUT

      const handler = onClickedListeners[0];
      await handler(
        { menuItemId: 'save-image', srcUrl: 'https://example.com/photo.jpg', pageUrl: 'https://example.com/page' },
        { id: 1, title: 'Test Page' }
      );

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/photo.jpg');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/inbox/files/test-uuid-1234.jpg'),
        expect.objectContaining({ method: 'PUT' })
      );

      const metadataCall = mockFetch.mock.calls[2];
      expect(metadataCall[0]).toContain('/inbox/items/test-uuid-1234');
      const storedItem = JSON.parse(metadataCall[1].body);
      expect(storedItem).toMatchObject({
        id: 'test-uuid-1234',
        type: 'image',
        filePath: 'files/test-uuid-1234.jpg',
        mimeType: 'image/jpeg',
        sourceUrl: 'https://example.com/photo.jpg',
        description: 'Source page: https://example.com/page',
      });
    });

    it('does nothing when image download fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const handler = onClickedListeners[0];
      await handler(
        { menuItemId: 'save-image', srcUrl: 'https://example.com/broken.jpg' },
        { id: 1 }
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('context menu: save-link', () => {
    it('stores a BookmarkItem with the link URL', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const handler = onClickedListeners[0];
      await handler(
        { menuItemId: 'save-link', linkUrl: 'https://example.com/article', linkText: 'Great Article' },
        { id: 1 }
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/inbox/items/test-uuid-1234'),
        expect.objectContaining({ method: 'PUT' })
      );

      const storedItem = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(storedItem).toMatchObject({
        id: 'test-uuid-1234',
        type: 'bookmark',
        title: 'Great Article',
        url: 'https://example.com/article',
      });
    });
  });

  describe('context menu: save-selection', () => {
    it('stores a NoteItem with selected text', async () => {
      mockTabsSendMessage.mockResolvedValue({ title: 'Source Page' });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const handler = onClickedListeners[0];
      await handler(
        { menuItemId: 'save-selection', selectionText: 'Selected paragraph of text' },
        { id: 1, title: 'Tab Title', url: 'https://example.com' }
      );

      const storedItem = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(storedItem).toMatchObject({
        type: 'note',
        title: 'From: Source Page',
        body: 'Selected paragraph of text',
        description: 'Source: https://example.com',
      });
    });
  });

  describe('message: download-and-store-image', () => {
    it('downloads and stores the image file to RS', async () => {
      const imageBuffer = new ArrayBuffer(50);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'image/png' }),
          arrayBuffer: () => Promise.resolve(imageBuffer),
        })
        .mockResolvedValueOnce({ ok: true });

      const handler = onMessageListeners[0];
      const result = await handler({
        type: 'download-and-store-image',
        url: 'https://example.com/icon.png',
        filePath: 'files/abc.png',
      }, {});

      expect(result).toEqual({ ok: true, mimeType: 'image/png' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/inbox/files/abc.png'),
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('returns ok:false when download fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const handler = onMessageListeners[0];
      const result = await handler({
        type: 'download-and-store-image',
        url: 'https://example.com/missing.png',
        filePath: 'files/abc.png',
      }, {});

      expect(result).toEqual({ ok: false });
    });

    it('returns ok:false when config is missing', async () => {
      mockStorageGet.mockResolvedValue({});

      const handler = onMessageListeners[0];
      const result = await handler({
        type: 'download-and-store-image',
        url: 'https://example.com/img.png',
        filePath: 'files/abc.png',
      }, {});

      expect(result).toEqual({ ok: false });
    });
  });

  describe('message: fetch-metadata', () => {
    it('returns page metadata from content script', async () => {
      const metadata = { title: 'Test', ogImage: 'https://example.com/og.jpg' };
      mockTabsSendMessage.mockResolvedValue(metadata);

      const handler = onMessageListeners[0];
      const result = await handler({ type: 'fetch-metadata', tabId: 42 }, {});

      expect(mockTabsSendMessage).toHaveBeenCalledWith(42, { type: 'get-metadata' });
      expect(result).toEqual(metadata);
    });
  });
});
