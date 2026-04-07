import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock URL.createObjectURL
let blobUrlCounter = 0;
vi.stubGlobal('URL', {
  ...globalThis.URL,
  createObjectURL: (blob: Blob) => `blob:test/${blobUrlCounter++}`,
  revokeObjectURL: vi.fn(),
});

import { fetchFileWithAuth } from './rs';

describe('fetchFileWithAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blobUrlCounter = 0;
  });

  it('fetches file with Authorization Bearer header', async () => {
    const imageBlob = new Blob(['fake-image-data'], { type: 'image/jpeg' });
    mockFetch.mockResolvedValue({ ok: true, blob: () => Promise.resolve(imageBlob) });

    const result = await fetchFileWithAuth(
      'https://storage.5apps.com/user',
      'my-token',
      'files/abc.jpg'
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://storage.5apps.com/user/inbox/files/abc.jpg',
      { headers: { 'Authorization': 'Bearer my-token' } }
    );
    expect(result).toBe('blob:test/0');
  });

  it('returns null when server returns non-OK response (e.g. 401)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const result = await fetchFileWithAuth(
      'https://storage.5apps.com/user',
      'bad-token',
      'files/abc.jpg'
    );

    expect(result).toBeNull();
  });

  it('returns null when server returns 404', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const result = await fetchFileWithAuth(
      'https://storage.5apps.com/user',
      'my-token',
      'files/nonexistent.jpg'
    );

    expect(result).toBeNull();
  });

  it('returns null when fetch throws (network error)', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));

    const result = await fetchFileWithAuth(
      'https://storage.5apps.com/user',
      'my-token',
      'files/abc.jpg'
    );

    expect(result).toBeNull();
  });

  it('constructs correct URL with path under /inbox/', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob([])),
    });

    await fetchFileWithAuth(
      'https://storage.example.com/storage/nick',
      'token123',
      'files/deep/nested/photo.png'
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://storage.example.com/storage/nick/inbox/files/deep/nested/photo.png',
      expect.any(Object)
    );
  });

  it('returns unique blob URLs for different files', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob([])),
    });

    const url1 = await fetchFileWithAuth('https://s.example.com/u', 'tok', 'files/a.jpg');
    const url2 = await fetchFileWithAuth('https://s.example.com/u', 'tok', 'files/b.jpg');

    expect(url1).not.toBe(url2);
  });
});
