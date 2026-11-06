import { describe, expect, it, vi } from 'vitest';
import {
  consumeSharedFiles,
  discardSharedFiles,
  listSharedFiles,
  stashShare,
} from './share-target';

const keyOf = (key: RequestInfo | URL) =>
  typeof key === 'string' ? key : (key as Request).url;

/** In-memory stand-in for a Cache API cache (insertion-ordered, like the real one). */
function fakeCache() {
  const entries = new Map<string, Response>();
  return {
    entries,
    put: async (key: RequestInfo | URL, response: Response) =>
      void entries.set(String(key), response),
    // Like the real one: keys come back as Requests, matches are fresh bodies.
    keys: async () => [...entries.keys()].map((k) => ({ url: k }) as Request),
    match: async (key: RequestInfo | URL) => entries.get(keyOf(key))?.clone(),
    delete: async (key: RequestInfo | URL) => entries.delete(keyOf(key)),
  } as unknown as Cache & { entries: Map<string, Response> };
}

function form(fields: Record<string, string | File | File[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

describe('stashShare', () => {
  it('redirects a text-only share exactly like the old GET share target', async () => {
    const cache = fakeCache();
    const target = await stashShare(
      form({ title: 'A page', text: '', url: 'https://example.com/a?b=c' }),
      cache,
    );

    expect(target).toBe(
      '/capture/?title=A+page&url=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc',
    );
    expect(cache.entries.size).toBe(0);
  });

  it('stashes every shared file and redirects to the bare shell', async () => {
    const cache = fakeCache();
    const target = await stashShare(
      form({
        files: [
          new File(['BEGIN:VCALENDAR'], 'Café invite.ics', {
            type: 'text/calendar',
          }),
          new File(['png'], 'shot.png', { type: 'image/png' }),
        ],
      }),
      cache,
    );

    expect(target).toBe('/capture/');
    expect(cache.entries.size).toBe(2);
  });

  it('skips the empty file part some share sheets send', async () => {
    const cache = fakeCache();
    await stashShare(
      form({ text: 'hi', files: new File([], '', { type: '' }) }),
      cache,
    );
    expect(cache.entries.size).toBe(0);
  });
});

describe('consumeSharedFiles', () => {
  it('hands back files with name, type and bytes intact, then clears them', async () => {
    const cache = fakeCache();
    await stashShare(
      form({
        files: [
          new File(['BEGIN:VCALENDAR'], 'Café invite.ics', {
            type: 'text/calendar',
          }),
          new File(['png'], 'shot.png', { type: 'image/png' }),
        ],
      }),
      cache,
    );

    const received: File[] = [];
    const count = await consumeSharedFiles(cache, async (file) => {
      received.push(file);
    });

    expect(count).toBe(2);
    expect(received.map((f) => [f.name, f.type])).toEqual([
      ['Café invite.ics', 'text/calendar'],
      ['shot.png', 'image/png'],
    ]);
    expect(await received[0].text()).toBe('BEGIN:VCALENDAR');
    expect(cache.entries.size).toBe(0);
  });

  it('takes an origin-wide Web Lock while consuming, when the browser has one', async () => {
    const request = vi.fn((_name: string, cb: () => Promise<number>) => cb());
    vi.stubGlobal('navigator', { locks: { request } });
    try {
      const cache = fakeCache();
      await stashShare(
        form({ files: new File(['x'], 'a.ics', { type: 'text/calendar' }) }),
        cache,
      );
      await expect(consumeSharedFiles(cache, async () => {})).resolves.toBe(1);
      expect(request).toHaveBeenCalledWith(
        'share-target',
        expect.any(Function),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lists stashed files without taking them, and discards them all', async () => {
    const cache = fakeCache();
    await stashShare(
      form({ files: new File(['x'], 'a.ics', { type: 'text/calendar' }) }),
      cache,
    );
    expect((await listSharedFiles(cache)).map((e) => e.file.name)).toEqual([
      'a.ics',
    ]);
    expect(cache.entries.size).toBe(1);
    await discardSharedFiles(cache);
    expect(cache.entries.size).toBe(0);
  });

  it('scopes save and discard to the listed keys, leaving later arrivals', async () => {
    const cache = fakeCache();
    await stashShare(
      form({ files: new File(['x'], 'seen.ics', { type: 'text/calendar' }) }),
      cache,
    );
    const seen = (await listSharedFiles(cache)).map((e) => e.key);
    await stashShare(
      form({ files: new File(['y'], 'later.ics', { type: 'text/calendar' }) }),
      cache,
    );
    const handled: string[] = [];
    await consumeSharedFiles(
      cache,
      async (f) => {
        handled.push(f.name);
      },
      seen,
    );
    expect(handled).toEqual(['seen.ics']);
    expect((await listSharedFiles(cache)).map((e) => e.file.name)).toEqual([
      'later.ics',
    ]);
    await discardSharedFiles(cache, seen);
    expect(cache.entries.size).toBe(1);
  });

  it('keeps a file whose handling failed for the next start', async () => {
    const cache = fakeCache();
    await stashShare(
      form({ files: new File(['x'], 'a.ics', { type: 'text/calendar' }) }),
      cache,
    );

    await expect(
      consumeSharedFiles(cache, async () => {
        throw new Error('quota');
      }),
    ).rejects.toThrow('quota');
    expect(cache.entries.size).toBe(1);
  });
});
