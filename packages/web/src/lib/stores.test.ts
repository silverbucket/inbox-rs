// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

// Mock the RS module to prevent RemoteStorage initialization side effects
const { mockFetchFileBlobUrl } = vi.hoisted(() => {
  const mockFetchFileBlobUrl = vi.fn();
  return { mockFetchFileBlobUrl };
});

vi.mock('./rs', () => {
  const rs = {
    access: { claim: vi.fn() },
    caching: { enable: vi.fn() },
    setSyncInterval: vi.fn(),
    on: vi.fn(),
    remote: {},
    startSync: vi.fn(),
    inbox: {
      getAll: vi.fn().mockResolvedValue({}),
      getConfig: vi.fn().mockResolvedValue({}),
      getAllCollections: vi.fn().mockResolvedValue({}),
      getAllGroups: vi.fn().mockResolvedValue({}),
      onChange: vi.fn(),
      store: vi.fn(),
      remove: vi.fn(),
    },
  };
  return {
    default: rs,
    fetchFileBlobUrl: mockFetchFileBlobUrl,
    fetchFileWithAuth: vi.fn(),
    getFileUrl: vi.fn(),
  };
});

// Mock clean-for-storage
vi.mock('./clean-for-storage', () => ({
  cleanForStorage: (x: any) => x,
}));

import { blobUrls, connected, loadFileBlobUrl } from './stores';

describe('loadFileBlobUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blobUrls.set({});
    connected.set(true);
  });

  it('fetches file and stores blob URL in blobUrls store', async () => {
    mockFetchFileBlobUrl.mockResolvedValue('blob:test/123');

    loadFileBlobUrl('files/photo.jpg');

    // Wait for the async fetch to complete
    await vi.waitFor(() => {
      expect(get(blobUrls)['files/photo.jpg']).toBe('blob:test/123');
    });

    expect(mockFetchFileBlobUrl).toHaveBeenCalledWith('files/photo.jpg');
  });

  it('does not fetch if blob URL already exists', () => {
    blobUrls.set({ 'files/photo.jpg': 'blob:existing/456' });

    loadFileBlobUrl('files/photo.jpg');

    expect(mockFetchFileBlobUrl).not.toHaveBeenCalled();
  });

  it('does not fetch if not connected', () => {
    connected.set(false);

    loadFileBlobUrl('files/photo.jpg');

    expect(mockFetchFileBlobUrl).not.toHaveBeenCalled();
  });

  it('does not fetch for empty filePath', () => {
    loadFileBlobUrl('');

    expect(mockFetchFileBlobUrl).not.toHaveBeenCalled();
  });

  it('does not store blob URL when fetch returns null', async () => {
    mockFetchFileBlobUrl.mockResolvedValue(null);

    loadFileBlobUrl('files/missing.jpg');

    // Wait for the async fetch to complete
    await vi.waitFor(() => {
      expect(mockFetchFileBlobUrl).toHaveBeenCalled();
    });

    // Small delay to ensure the .then() callback has run
    await new Promise(r => setTimeout(r, 10));
    expect(get(blobUrls)['files/missing.jpg']).toBeUndefined();
  });

  it('deduplicates concurrent requests for the same path', async () => {
    let resolveFirst!: (url: string) => void;
    mockFetchFileBlobUrl.mockReturnValue(
      new Promise<string>(r => { resolveFirst = r; })
    );

    loadFileBlobUrl('files/photo.jpg');
    loadFileBlobUrl('files/photo.jpg');
    loadFileBlobUrl('files/photo.jpg');

    expect(mockFetchFileBlobUrl).toHaveBeenCalledTimes(1);

    resolveFirst('blob:test/deduped');
    await vi.waitFor(() => {
      expect(get(blobUrls)['files/photo.jpg']).toBe('blob:test/deduped');
    });
  });

  it('allows re-fetch after a failed attempt', async () => {
    mockFetchFileBlobUrl.mockResolvedValueOnce(null);

    loadFileBlobUrl('files/retry.jpg');

    // Wait for first attempt to complete
    await vi.waitFor(() => {
      expect(mockFetchFileBlobUrl).toHaveBeenCalledTimes(1);
    });
    await new Promise(r => setTimeout(r, 10));

    // Second attempt should be allowed since first failed (no blob URL stored)
    mockFetchFileBlobUrl.mockResolvedValueOnce('blob:test/retry-ok');
    loadFileBlobUrl('files/retry.jpg');

    await vi.waitFor(() => {
      expect(get(blobUrls)['files/retry.jpg']).toBe('blob:test/retry-ok');
    });

    expect(mockFetchFileBlobUrl).toHaveBeenCalledTimes(2);
  });

  it('handles multiple different files independently', async () => {
    mockFetchFileBlobUrl
      .mockResolvedValueOnce('blob:test/a')
      .mockResolvedValueOnce('blob:test/b');

    loadFileBlobUrl('files/a.jpg');
    loadFileBlobUrl('files/b.png');

    await vi.waitFor(() => {
      const urls = get(blobUrls);
      expect(urls['files/a.jpg']).toBe('blob:test/a');
      expect(urls['files/b.png']).toBe('blob:test/b');
    });

    expect(mockFetchFileBlobUrl).toHaveBeenCalledTimes(2);
  });
});
