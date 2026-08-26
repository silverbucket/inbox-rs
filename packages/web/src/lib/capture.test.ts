// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const { storeItem, moveItemToCollection, collections } = vi.hoisted(() => {
  // Minimal readable-store stub so `get(collections)` resolves synchronously.
  const map: Record<string, unknown> = {
    'col-1': { id: 'col-1', name: 'Col' },
  };
  return {
    storeItem: vi.fn().mockResolvedValue(undefined),
    moveItemToCollection: vi.fn().mockResolvedValue(undefined),
    collections: {
      subscribe: (run: (value: unknown) => void) => {
        run(map);
        return () => {};
      },
    },
  };
});
vi.mock('./stores', () => ({ storeItem, moveItemToCollection, collections }));

const { enrichBookmark } = vi.hoisted(() => ({
  enrichBookmark: vi.fn().mockResolvedValue('updated'),
}));
vi.mock('./enrich', () => ({ enrichBookmark }));

import { captureDetected, captureFile, downloadDirectImage } from './capture';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('captureDetected', () => {
  it('stores a bookmark for a URL', async () => {
    const res = await captureDetected('https://example.com');
    expect(res?.item.type).toBe('bookmark');
    expect(storeItem).toHaveBeenCalledOnce();
    expect((storeItem.mock.calls[0][0] as { url: string }).url).toBe(
      'https://example.com',
    );
  });

  it('downloads and stores a direct image URL as an image card', async () => {
    const imageBytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(imageBytes, {
          status: 200,
          headers: {
            'content-type': 'IMAGE/JPEG; charset=binary',
            'content-length': String(imageBytes.byteLength),
          },
        }),
      ),
    );

    const url = 'https://cdn.example.com/photos/rolling%20stone.jpg?width=1200';
    const res = await captureDetected(url);

    expect(res?.item).toMatchObject({
      type: 'image',
      title: 'rolling stone.jpg',
      mimeType: 'image/jpeg',
      sourceUrl: url,
    });
    expect(storeItem.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer);
    expect(enrichBookmark).not.toHaveBeenCalled();
  });

  it('normalizes an uppercase image MIME type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1]), {
          headers: { 'content-type': 'IMAGE/JPEG' },
        }),
      ),
    );

    const file = await downloadDirectImage('https://example.com/photo.jpg');

    expect(file).toBeInstanceOf(File);
    expect(file?.type).toBe('image/jpeg');
  });

  it('cancels an image stream when an unannounced body exceeds 25 MB', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(20 * 1024 * 1024));
        controller.enqueue(new Uint8Array(6 * 1024 * 1024));
      },
      cancel,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          headers: { 'content-type': 'image/jpeg' },
        }),
      ),
    );

    const file = await downloadDirectImage('https://example.com/large.jpg');

    expect(file).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('falls back to a bookmark when an image-looking URL is not an image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>not found</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );

    const url = 'https://example.com/not-really.jpg';
    const res = await captureDetected(url);

    expect(res?.item.type).toBe('bookmark');
    expect(enrichBookmark).toHaveBeenCalledWith(res?.item);
  });

  it('kicks off background metadata enrichment for bookmarks', async () => {
    const res = await captureDetected('https://example.com');
    expect(enrichBookmark).toHaveBeenCalledOnce();
    expect(enrichBookmark).toHaveBeenCalledWith(res?.item);
  });

  it('does not swallow the capture when enrichment fails', async () => {
    enrichBookmark.mockRejectedValueOnce(new Error('metadata server down'));
    const res = await captureDetected('https://example.com');
    expect(res?.item.type).toBe('bookmark');
    expect(storeItem).toHaveBeenCalledOnce();
  });

  it('does not attempt enrichment for notes', async () => {
    await captureDetected('remember the milk');
    expect(enrichBookmark).not.toHaveBeenCalled();
  });

  it('stores a note for text, preserving the body', async () => {
    const res = await captureDetected('remember the milk');
    expect(res?.item.type).toBe('note');
    expect((res?.item as { body: string }).body).toBe('remember the milk');
    expect(storeItem).toHaveBeenCalledOnce();
  });

  it('is a no-op for empty input', async () => {
    expect(await captureDetected('   ')).toBeNull();
    expect(storeItem).not.toHaveBeenCalled();
  });

  it('files the item into a collection when a collectionId is given', async () => {
    const res = await captureDetected('remember the milk', 'col-1');
    expect(storeItem).toHaveBeenCalledOnce();
    expect(moveItemToCollection).toHaveBeenCalledWith(res?.item.id, 'col-1');
  });

  it('does not file into a collection for plain inbox captures', async () => {
    await captureDetected('remember the milk');
    expect(moveItemToCollection).not.toHaveBeenCalled();
  });

  it('throws before storing when the target collection no longer exists', async () => {
    await expect(
      captureDetected('remember the milk', 'gone'),
    ).rejects.toThrow();
    // Nothing stored or filed — no orphaned item left in the Inbox.
    expect(storeItem).not.toHaveBeenCalled();
    expect(moveItemToCollection).not.toHaveBeenCalled();
  });
});

describe('captureFile', () => {
  it('stores an image item for an image file, defaulting the title to the name', async () => {
    const file = new File(['x'], 'sunset.png', { type: 'image/png' });
    const res = await captureFile(file);
    expect(res?.item.type).toBe('image');
    expect(res?.item.title).toBe('sunset.png');
    expect(storeItem).toHaveBeenCalledOnce();
    // The binary payload is passed alongside the metadata item.
    expect(storeItem.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer);
  });

  it('stores a document item for a non-image file', async () => {
    const file = new File(['x'], 'report.pdf', { type: 'application/pdf' });
    const res = await captureFile(file);
    expect(res?.item.type).toBe('document');
    expect(res?.item.title).toBe('report.pdf');
    expect(storeItem).toHaveBeenCalledOnce();
  });

  it('uses a caption as the item title when given', async () => {
    const file = new File(['x'], 'sunset.png', { type: 'image/png' });
    const res = await captureFile(file, '  Golden hour  ');
    expect(res?.item.title).toBe('Golden hour');
  });

  it('files the item into a collection when a collectionId is given', async () => {
    const file = new File(['x'], 'sunset.png', { type: 'image/png' });
    const res = await captureFile(file, '', 'col-1');
    expect(moveItemToCollection).toHaveBeenCalledWith(res?.item.id, 'col-1');
  });

  it('throws before storing when the target collection no longer exists', async () => {
    const file = new File(['x'], 'sunset.png', { type: 'image/png' });
    await expect(captureFile(file, '', 'gone')).rejects.toThrow();
    expect(storeItem).not.toHaveBeenCalled();
    expect(moveItemToCollection).not.toHaveBeenCalled();
  });
});
