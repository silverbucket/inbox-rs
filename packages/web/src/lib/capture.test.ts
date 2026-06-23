// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const { storeItem, moveItemToCollection } = vi.hoisted(() => ({
  storeItem: vi.fn().mockResolvedValue(undefined),
  moveItemToCollection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./stores', () => ({ storeItem, moveItemToCollection }));

import { captureDetected } from './capture';

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
});
