import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { fetchStorageUsage, formatBytes } from './storage-usage';

const HREF = 'https://storage.example/nick';

/** Serve folder descriptions keyed by path; anything else is a 404. */
function serve(folders: Record<string, unknown>) {
  mockFetch.mockImplementation((url: string) => {
    const path = url.slice(HREF.length);
    if (!(path in folders)) {
      return Promise.resolve({ ok: false, status: 404 });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(folders[path]),
    });
  });
}

describe('fetchStorageUsage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sums Content-Length across nested folders', async () => {
    serve({
      '/inbox/': {
        items: { 'items/': { ETag: 'a' }, 'files/': { ETag: 'b' } },
      },
      '/inbox/items/': {
        items: {
          one: { ETag: '1', 'Content-Length': 100 },
          two: { ETag: '2', 'Content-Length': 250 },
        },
      },
      '/inbox/files/': {
        items: { 'pic.png': { ETag: '3', 'Content-Length': 5000 } },
      },
    });
    expect(await fetchStorageUsage(HREF, 'tok')).toBe(5350);
  });

  it('sends the bearer token', async () => {
    serve({ '/inbox/': { items: {} } });
    await fetchStorageUsage(HREF, 'tok');
    expect(mockFetch).toHaveBeenCalledWith(`${HREF}/inbox/`, {
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('treats a missing folder as empty', async () => {
    serve({});
    expect(await fetchStorageUsage(HREF, 'tok')).toBe(0);
  });

  it('returns null when a listing has no sizes', async () => {
    serve({ '/inbox/': { items: { one: { ETag: '1' } } } });
    expect(await fetchStorageUsage(HREF, 'tok')).toBeNull();
  });

  it('returns null for pre-folder-description listings', async () => {
    serve({ '/inbox/': { one: 'etag-1' } });
    expect(await fetchStorageUsage(HREF, 'tok')).toBeNull();
  });

  it('returns null when a subfolder request fails', async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith('/inbox/')
          ? {
              ok: true,
              status: 200,
              json: () => Promise.resolve({ items: { 'files/': {} } }),
            }
          : { ok: false, status: 500 },
      ),
    );
    expect(await fetchStorageUsage(HREF, 'tok')).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    expect(await fetchStorageUsage(HREF, 'tok')).toBeNull();
  });
});

describe('formatBytes', () => {
  it('formats across units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(4.2 * 1024 * 1024)).toBe('4.2 MB');
    expect(formatBytes(1.3 * 1024 ** 3)).toBe('1.3 GB');
  });
});
