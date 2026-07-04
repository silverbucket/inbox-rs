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

import { captureFile, captureDetected } from './capture';

afterEach(() => vi.clearAllMocks());

describe('captureDetected', () => {
  it('stores a bookmark for a URL', async () => {
    const res = await captureDetected('https://example.com');
    expect(res?.item.type).toBe('bookmark');
    expect(storeItem).toHaveBeenCalledOnce();
    expect((storeItem.mock.calls[0][0] as { url: string }).url).toBe(
      'https://example.com',
    );
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
