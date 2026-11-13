import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadLinkImage,
  ImageDownloadError,
  imageExtension,
  isPlaceholderImage,
  normalizeMetadata,
  supportsImageDownload,
} from './link-metadata';

describe('normalizeMetadata event', () => {
  it('keeps a well-formed page event', () => {
    expect(
      normalizeMetadata({
        type: 'page',
        event: {
          name: ' Tech Talks ',
          startDate: '2026-11-09T18:00:00-06:00',
          endDate: '2026-11-09T20:00:00-06:00',
          location: 'Austin, TX',
          status: 'scheduled',
        },
      }),
    ).toEqual({
      title: undefined,
      description: undefined,
      image: undefined,
      siteName: undefined,
      favicon: undefined,
      event: {
        name: 'Tech Talks',
        startDate: '2026-11-09T18:00:00-06:00',
        endDate: '2026-11-09T20:00:00-06:00',
        location: 'Austin, TX',
      },
    });
  });

  it('drops an event without a parseable start', () => {
    expect(
      normalizeMetadata({ event: { name: 'X', startDate: 'soon' } }),
    ).toBeNull();
    // Date.parse would roll this over to March 2.
    expect(
      normalizeMetadata({ event: { name: 'X', startDate: '2026-02-30' } }),
    ).toBeNull();
    expect(
      normalizeMetadata({
        event: { name: 'X', startDate: '2026-02-30T10:00:00-06:00' },
      }),
    ).toBeNull();
    expect(
      normalizeMetadata({ title: 'T', event: { name: 'X' } })?.event,
    ).toBeUndefined();
  });

  it('drops an unparseable end date but keeps the event', () => {
    expect(
      normalizeMetadata({
        event: { name: 'X', startDate: '2026-11-09', endDate: 'later' },
      })?.event,
    ).toEqual({
      name: 'X',
      startDate: '2026-11-09',
      endDate: undefined,
      location: undefined,
    });
  });
});

describe('isPlaceholderImage', () => {
  it('flags generic share cards and fallbacks', () => {
    expect(
      isPlaceholderImage('https://share.redd.it/preview/post/1xlli1q'),
    ).toBe(true);
    expect(
      isPlaceholderImage(
        'https://m.media-amazon.com/images/G/01/share-icons/previewdoh/amazon.png',
      ),
    ).toBe(true);
    expect(isPlaceholderImage('https://x.com/default/og.png')).toBe(true);
    expect(isPlaceholderImage('https://x.com/placeholder.png')).toBe(true);
  });

  it('keeps real images', () => {
    expect(isPlaceholderImage('https://i.redd.it/g6oz7p3e14zh1.jpeg')).toBe(
      false,
    );
    expect(
      isPlaceholderImage('https://m.media-amazon.com/images/I/81abc.jpg'),
    ).toBe(false);
    expect(isPlaceholderImage(undefined)).toBe(false);
    expect(isPlaceholderImage('not a url')).toBe(false);
  });
});

describe('downloadLinkImage', () => {
  afterEach(() => vi.unstubAllGlobals());

  function reply(line: unknown, status = 200) {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(`${JSON.stringify(line)}\n`, { status }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('asks the media platform for the image and decodes its bytes', async () => {
    const fetchMock = reply({
      type: 'download',
      object: {
        type: 'image',
        url: 'https://cdn.example.com/final.jpg',
        mediaType: 'image/jpeg',
        size: 3,
        data: btoa('\u0001\u0002\u00ff'),
      },
    });

    const image = await downloadLinkImage(
      'https://example.com/article',
      '/hero.jpg',
      'https://hub.example/sockethub-http',
    );

    expect(image.url).toBe('https://cdn.example.com/final.jpg');
    expect(image.mimeType).toBe('image/jpeg');
    expect(new Uint8Array(image.data)).toEqual(new Uint8Array([1, 2, 255]));
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe('https://hub.example/sockethub-http');
    expect(JSON.parse(init.body)).toMatchObject({
      type: 'download',
      actor: { id: 'https://example.com/article', type: 'website' },
      object: { type: 'image', url: '/hero.jpg' },
    });
  });

  it('sends a fresh request id each time', async () => {
    const fetchMock = reply({ error: 'x' });
    await downloadLinkImage('https://a', 'https://a/i').catch(() => {});
    await downloadLinkImage('https://a', 'https://a/i').catch(() => {});
    const ids = fetchMock.mock.calls.map(
      ([, init]) => init.headers['X-Request-Id'],
    );
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('reports the failure code Sockethub gives', async () => {
    reply({
      error:
        'Error: image download failed (not-found) for https://a/i.png: HTTP 404',
    });
    const error = await downloadLinkImage('https://a', 'https://a/i.png').catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ImageDownloadError);
    expect(error.code).toBe('not-found');
  });

  it('reports an unrecognised failure as unknown', async () => {
    reply({ error: 'Error: platform crashed' });
    await expect(
      downloadLinkImage('https://a', 'https://a/i.png'),
    ).rejects.toMatchObject({ code: 'unknown' });
  });

  it('rejects a reply that carries no image', async () => {
    reply({ object: { type: 'image', mediaType: 'text/html', data: 'aGk=' } });
    await expect(
      downloadLinkImage('https://a', 'https://a/i.png'),
    ).rejects.toMatchObject({ code: 'unknown' });
  });

  it('rejects when the server itself answers with an error status', async () => {
    reply({}, 503);
    await expect(
      downloadLinkImage('https://a', 'https://a/i.png'),
    ).rejects.toThrow('503');
  });
});

describe('image download helpers', () => {
  it('maps the image types Sockethub returns to file extensions', () => {
    expect(imageExtension('image/jpeg')).toBe('jpg');
    expect(imageExtension('image/x-icon')).toBe('ico');
    expect(imageExtension('image/SVG+XML')).toBe('svg');
    expect(imageExtension('image/tiff')).toBeUndefined();
  });

  it('detects the media platform in the server info', () => {
    const info = (ids: string[]) => ({
      name: 'sockethub' as const,
      apiVersion: 5,
      platforms: ids.map((id) => ({ id, apiVersion: 1 })),
    });
    expect(supportsImageDownload(info(['metadata', 'media']))).toBe(true);
    expect(supportsImageDownload(info(['metadata']))).toBe(false);
    expect(supportsImageDownload(null)).toBe(false);
  });
});
