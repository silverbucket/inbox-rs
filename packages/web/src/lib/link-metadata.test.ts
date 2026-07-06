import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLinkMetadata,
  normalizeMetadata,
  SOCKETHUB_HTTP_ENDPOINT,
} from './link-metadata';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('normalizeMetadata', () => {
  it('extracts the documented title/description/image fields', () => {
    expect(
      normalizeMetadata({
        type: 'message',
        title: 'Page Title',
        description: 'A description',
        image: 'https://example.com/og.jpg',
        url: 'https://example.com',
      }),
    ).toEqual({
      title: 'Page Title',
      description: 'A description',
      image: 'https://example.com/og.jpg',
      siteName: undefined,
      favicon: undefined,
    });
  });

  it('reads image descriptor objects and arrays', () => {
    expect(
      normalizeMetadata({ title: 't', image: { url: 'https://x/i.png' } })
        ?.image,
    ).toBe('https://x/i.png');
    expect(
      normalizeMetadata({ title: 't', image: [{ url: 'https://x/1.png' }] })
        ?.image,
    ).toBe('https://x/1.png');
  });

  it('reads alternate site-name/favicon spellings', () => {
    expect(
      normalizeMetadata({ title: 't', site_name: 'Example', icon: '/f.ico' }),
    ).toMatchObject({ siteName: 'Example', favicon: '/f.ico' });
  });

  it('trims whitespace and drops empty strings', () => {
    expect(normalizeMetadata({ title: '  Padded  ', description: '   ' })).toEqual(
      {
        title: 'Padded',
        description: undefined,
        image: undefined,
        siteName: undefined,
        favicon: undefined,
      },
    );
  });

  it('returns null when nothing usable is present', () => {
    expect(normalizeMetadata(undefined)).toBeNull();
    expect(normalizeMetadata('nope')).toBeNull();
    expect(normalizeMetadata({})).toBeNull();
    expect(normalizeMetadata({ type: 'message', url: 'https://x' })).toBeNull();
    // A favicon alone isn't a preview.
    expect(normalizeMetadata({ favicon: '/f.ico' })).toBeNull();
  });
});

function ndjsonResponse(lines: unknown[], status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () =>
      Promise.resolve(lines.map((l) => JSON.stringify(l)).join('\n') + '\n'),
  };
}

describe('fetchLinkMetadata', () => {
  it('POSTs an ActivityStreams fetch and returns the normalized result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ndjsonResponse([
        {
          type: 'fetch',
          actor: { id: 'https://example.com' },
          object: { type: 'message', title: 'Example', image: 'https://x/i.png' },
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const meta = await fetchLinkMetadata('https://example.com');
    expect(meta).toMatchObject({ title: 'Example', image: 'https://x/i.png' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe(SOCKETHUB_HTTP_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers['X-Request-Id']).toBeTruthy();
    const body = JSON.parse(init.body);
    expect(body.type).toBe('fetch');
    expect(body.actor).toEqual({ id: 'https://example.com' });
    expect(body['@context']).toContain(
      'https://sockethub.org/ns/context/platform/metadata/v1.jsonld',
    );
  });

  it('resolves null when the page has no usable metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        ndjsonResponse([
          { type: 'fetch', actor: { id: 'https://x' }, object: { type: 'message' } },
        ]),
      ),
    );
    await expect(fetchLinkMetadata('https://x')).resolves.toBeNull();
  });

  it('rejects when the result line carries a platform error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        ndjsonResponse([{ type: 'error', error: 'could not fetch page' }]),
      ),
    );
    await expect(fetchLinkMetadata('https://x')).rejects.toThrow(
      'could not fetch page',
    );
  });

  it('rejects on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([], 404)));
    await expect(fetchLinkMetadata('https://x')).rejects.toThrow('404');
  });

  it('resolves null on an empty response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([])));
    await expect(fetchLinkMetadata('https://x')).resolves.toBeNull();
  });
});
