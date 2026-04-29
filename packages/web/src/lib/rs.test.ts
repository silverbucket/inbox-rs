import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { recoverLegacyBinaryStringEncoding } from '@inbox-rs/rs-module';
import { fetchFileWithAuth } from './rs';

/**
 * Encode bytes the way the v1.8-and-earlier upload path did:
 * `String.fromCharCode(byte)` per byte to make a binary string, then UTF-8
 * encode that string (which is what `fetch(..., { body: string })` does).
 */
function legacyEncodeBytes(bytes: Uint8Array): Uint8Array {
  let binaryString = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return new TextEncoder().encode(binaryString);
}

/** Build a fake fetch Response matching what fetchFileWithAuth reads. */
function makeResponse(
  opts: {
    ok?: boolean;
    status?: number;
    contentType?: string | null;
    body?: ArrayBuffer;
  } = {},
) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type'
          ? (opts.contentType ?? null)
          : null,
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
      'files/abc.jpg',
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://storage.5apps.com/user/inbox/files/abc.jpg',
      { headers: { Authorization: 'Bearer my-token' } },
    );
    expect(result).toBe('blob:test/0');
  });

  it('returns null when server returns non-OK response (e.g. 401)', async () => {
    mockFetch.mockResolvedValue(makeResponse({ ok: false, status: 401 }));

    const result = await fetchFileWithAuth(
      'https://storage.5apps.com/user',
      'bad-token',
      'files/abc.jpg',
    );

    expect(result).toBeNull();
  });

  it('returns null when server returns 404', async () => {
    mockFetch.mockResolvedValue(makeResponse({ ok: false, status: 404 }));

    const result = await fetchFileWithAuth(
      'https://storage.5apps.com/user',
      'my-token',
      'files/nonexistent.jpg',
    );

    expect(result).toBeNull();
  });

  it('returns null when fetch throws (network error)', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));

    const result = await fetchFileWithAuth(
      'https://storage.5apps.com/user',
      'my-token',
      'files/abc.jpg',
    );

    expect(result).toBeNull();
  });

  it('constructs correct URL with path under /inbox/', async () => {
    mockFetch.mockResolvedValue(makeResponse({ contentType: 'image/png' }));

    await fetchFileWithAuth(
      'https://storage.example.com/storage/nick',
      'token123',
      'files/deep/nested/photo.png',
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://storage.example.com/storage/nick/inbox/files/deep/nested/photo.png',
      expect.any(Object),
    );
  });

  it('returns unique blob URLs for different files', async () => {
    mockFetch.mockResolvedValue(makeResponse({ contentType: 'image/jpeg' }));

    const url1 = await fetchFileWithAuth(
      'https://s.example.com/u',
      'tok',
      'files/a.jpg',
    );
    const url2 = await fetchFileWithAuth(
      'https://s.example.com/u',
      'tok',
      'files/b.jpg',
    );

    expect(url1).not.toBe(url2);
  });

  it('prefers expectedMimeType over the server-echoed Content-Type', async () => {
    // 5apps appends `; charset=binary` to binary Content-Types — the
    // resulting Blob type would otherwise be `image/jpeg; charset=binary`,
    // which Chrome refuses to render as an <img> source.
    mockFetch.mockResolvedValue(
      makeResponse({
        contentType: 'image/jpeg; charset=binary',
      }),
    );

    await fetchFileWithAuth(
      'https://storage.5apps.com/user',
      'my-token',
      'files/photo.jpg',
      'image/jpeg',
    );

    expect(lastCreatedBlob?.type).toBe('image/jpeg');
  });

  it('strips charset parameter from server Content-Type when no expectedMimeType is given', async () => {
    mockFetch.mockResolvedValue(
      makeResponse({
        contentType: 'image/jpeg; charset=binary',
      }),
    );

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

  it('recovers original bytes for files uploaded by the legacy binary-string path', async () => {
    // A JPEG header byte sequence — the legacy path UTF-8-encoded each byte,
    // turning 0xFF into 0xC3 0xBF and 0xD8 into 0xC3 0x98.
    const original = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]);
    const corrupted = legacyEncodeBytes(original);
    expect(corrupted.length).toBeGreaterThan(original.length); // sanity: encoding inflated the size

    mockFetch.mockResolvedValue(
      makeResponse({
        contentType: 'image/jpeg',
        body: corrupted.buffer.slice(
          corrupted.byteOffset,
          corrupted.byteOffset + corrupted.byteLength,
        ),
      }),
    );

    await fetchFileWithAuth(
      'https://storage.5apps.com/user',
      'my-token',
      'files/old-photo.jpg',
      'image/jpeg',
    );

    // The Blob should contain the recovered original bytes, not the corrupted ones.
    expect(lastCreatedBlob).toBeTruthy();
    const recoveredBuf = await lastCreatedBlob!.arrayBuffer();
    expect(new Uint8Array(recoveredBuf)).toEqual(original);
  });

  it('passes through correctly-uploaded binary files unchanged', async () => {
    const raw = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // raw JPEG header

    mockFetch.mockResolvedValue(
      makeResponse({
        contentType: 'image/jpeg',
        body: raw.buffer.slice(0),
      }),
    );

    await fetchFileWithAuth(
      'https://storage.5apps.com/user',
      'my-token',
      'files/new-photo.jpg',
      'image/jpeg',
    );

    expect(lastCreatedBlob).toBeTruthy();
    const result = new Uint8Array(await lastCreatedBlob!.arrayBuffer());
    expect(result).toEqual(raw);
  });
});

describe('recoverLegacyBinaryStringEncoding', () => {
  it('returns raw binary unchanged when the bytes are not valid UTF-8', () => {
    // Lone 0xFF is never a valid UTF-8 lead byte → TextDecoder({fatal}) throws.
    const raw = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]);
    const result = recoverLegacyBinaryStringEncoding(raw.buffer.slice(0));
    expect(new Uint8Array(result)).toEqual(raw);
  });

  it('recovers the original JPEG bytes from the legacy UTF-8-encoded form', () => {
    const original = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]);
    const corrupted = legacyEncodeBytes(original);
    const result = recoverLegacyBinaryStringEncoding(
      corrupted.buffer.slice(
        corrupted.byteOffset,
        corrupted.byteOffset + corrupted.byteLength,
      ),
    );
    expect(new Uint8Array(result)).toEqual(original);
  });

  it('recovers the original PNG bytes from the legacy UTF-8-encoded form', () => {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    const original = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const corrupted = legacyEncodeBytes(original);
    const result = recoverLegacyBinaryStringEncoding(
      corrupted.buffer.slice(
        corrupted.byteOffset,
        corrupted.byteOffset + corrupted.byteLength,
      ),
    );
    expect(new Uint8Array(result)).toEqual(original);
  });

  it('handles an empty buffer', () => {
    const result = recoverLegacyBinaryStringEncoding(new ArrayBuffer(0));
    expect(result.byteLength).toBe(0);
  });

  it('passes through pure ASCII unchanged (decoding gives same bytes back)', () => {
    // Pure ASCII is valid UTF-8 with all chars < 256 — the helper would
    // "recover" it, but the recovered bytes are identical to the input
    // because each ASCII byte UTF-8-encodes to itself.
    const ascii = new TextEncoder().encode('Hello, world!');
    const result = recoverLegacyBinaryStringEncoding(
      ascii.buffer.slice(ascii.byteOffset, ascii.byteOffset + ascii.byteLength),
    );
    expect(new Uint8Array(result)).toEqual(ascii);
  });

  it('does not touch real UTF-8 text containing non-Latin1 chars', () => {
    // "héllo 世界" — 世 has code point 0x4E16 which is >= 256, so the
    // recovery bails out and returns the bytes untouched.
    const text = new TextEncoder().encode('héllo 世界');
    const result = recoverLegacyBinaryStringEncoding(
      text.buffer.slice(text.byteOffset, text.byteOffset + text.byteLength),
    );
    expect(new Uint8Array(result)).toEqual(text);
  });

  it('round-trips: encode → recover gives back the original for a 256-byte sweep', () => {
    // Cover every possible byte value 0–255. This is the strongest possible
    // test of the inverse property because it exercises the full domain.
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;
    const corrupted = legacyEncodeBytes(original);
    const result = recoverLegacyBinaryStringEncoding(
      corrupted.buffer.slice(
        corrupted.byteOffset,
        corrupted.byteOffset + corrupted.byteLength,
      ),
    );
    expect(new Uint8Array(result)).toEqual(original);
  });
});
