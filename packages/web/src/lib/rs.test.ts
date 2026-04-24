import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock URL.createObjectURL. Capture the Blob passed in so tests can assert
// on its type — fetchFileWithAuth is supposed to build a fresh Blob with a
// clean MIME type (see the `; charset=binary` quirk in its JSDoc).
let blobUrlCounter = 0;
let lastCreatedBlob: Blob | null = null;
vi.stubGlobal('URL', {
  ...globalThis.URL,
  createObjectURL: (blob: Blob) => {
    lastCreatedBlob = blob;
    return `blob:test/${blobUrlCounter++}`;
  },
  revokeObjectURL: vi.fn(),
});

import { fetchFileWithAuth } from './rs';

/** Build a fake fetch Response matching what fetchFileWithAuth reads. */
function makeResponse(opts: {
  ok?: boolean;
  status?: number;
  contentType?: string | null;
  body?: ArrayBuffer;
} = {}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? (opts.contentType ?? null) : null,
    },
    arrayBuffer: () => Promise.resolve(opts.body ?? new ArrayBuffer(0)),
  };
}

describe('fetchFileWithAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blobUrlCounter = 0;
    lastCreatedBlob = null;
  });

  it('fetches file with Authorization Bearer header', async () => {
    mockFetch.mockResolvedValue(makeResponse({ contentType: 'image/jpeg' }));

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
    mockFetch.mockResolvedValue(makeResponse({ ok: false, status: 401 }));

    const result = await fetchFileWithAuth(
      'https://storage.5apps.com/user',
      'bad-token',
      'files/abc.jpg'
    );

    expect(result).toBeNull();
  });

  it('returns null when server returns 404', async () => {
    mockFetch.mockResolvedValue(makeResponse({ ok: false, status: 404 }));

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
    mockFetch.mockResolvedValue(makeResponse({ contentType: 'image/png' }));

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
    mockFetch.mockResolvedValue(makeResponse({ contentType: 'image/jpeg' }));

    const url1 = await fetchFileWithAuth('https://s.example.com/u', 'tok', 'files/a.jpg');
    const url2 = await fetchFileWithAuth('https://s.example.com/u', 'tok', 'files/b.jpg');

    expect(url1).not.toBe(url2);
  });

  it('prefers expectedMimeType over the server-echoed Content-Type', async () => {
    // 5apps appends `; charset=binary` to binary Content-Types — the
    // resulting Blob type would otherwise be `image/jpeg; charset=binary`,
    // which Chrome refuses to render as an <img> source.
    mockFetch.mockResolvedValue(makeResponse({
      contentType: 'image/jpeg; charset=binary',
    }));

    await fetchFileWithAuth(
      'https://storage.5apps.com/user',
      'my-token',
      'files/photo.jpg',
      'image/jpeg',
    );

    expect(lastCreatedBlob?.type).toBe('image/jpeg');
  });

  it('strips charset parameter from server Content-Type when no expectedMimeType is given', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      contentType: 'image/jpeg; charset=binary',
    }));

    await fetchFileWithAuth(
      'https://storage.5apps.com/user',
      'my-token',
      'files/photo.jpg',
    );

    expect(lastCreatedBlob?.type).toBe('image/jpeg');
  });

  it('falls back to application/octet-stream when neither expectedMimeType nor Content-Type is available', async () => {
    mockFetch.mockResolvedValue(makeResponse({ contentType: null }));

    await fetchFileWithAuth(
      'https://storage.5apps.com/user',
      'my-token',
      'files/photo.jpg',
    );

    expect(lastCreatedBlob?.type).toBe('application/octet-stream');
  });
});
