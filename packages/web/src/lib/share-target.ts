/**
 * Web Share Target (POST) hand-off between the service worker and the
 * capture shell. The OS share sheet POSTs multipart form data to /capture/;
 * the service worker stashes any files in the Cache API (which, unlike a
 * postMessage, survives the redirect and a cold shell start) and redirects to
 * /capture/ with the text fields as query params, the same URL the old GET
 * share target produced. The shell then takes the files out of the cache.
 *
 * Kept free of workbox and DOM-only APIs so both sides can be unit-tested.
 */

export const SHARE_CACHE = 'share-target';
const STASH_PREFIX = '/__share-target/';
const NAME_HEADER = 'x-file-name';
const TEXT_FIELDS = ['title', 'text', 'url'] as const;

type ShareCache = Pick<Cache, 'put' | 'keys' | 'match' | 'delete'>;

/**
 * Stash the shared files and return the capture-shell URL (path + query) to
 * redirect to. Title/text/url are carried exactly as the GET form sent them.
 */
export async function stashShare(
  form: FormData,
  cache: ShareCache,
): Promise<string> {
  for (const entry of form.getAll('files')) {
    if (typeof entry === 'string' || entry.size === 0) continue;
    await cache.put(
      `${STASH_PREFIX}${crypto.randomUUID()}`,
      new Response(entry, {
        headers: {
          'content-type': entry.type || 'application/octet-stream',
          [NAME_HEADER]: encodeURIComponent(entry.name),
        },
      }),
    );
  }
  const params = new URLSearchParams();
  for (const field of TEXT_FIELDS) {
    const value = form.get(field);
    if (typeof value === 'string' && value !== '') params.set(field, value);
  }
  const query = params.toString();
  return query ? `/capture/?${query}` : '/capture/';
}

async function fileFrom(response: Response): Promise<File> {
  const blob = await response.blob();
  const name = decodeURIComponent(response.headers.get(NAME_HEADER) ?? '');
  const type = response.headers.get('content-type') ?? blob.type;
  return new File([blob], name || 'shared-file', { type });
}

/** The stashed files, oldest first, left in place. */
export async function listSharedFiles(cache: ShareCache): Promise<File[]> {
  const files: File[] = [];
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (response) files.push(await fileFrom(response));
  }
  return files;
}

/** Drop every stashed file. */
export async function discardSharedFiles(cache: ShareCache): Promise<void> {
  for (const request of await cache.keys()) await cache.delete(request);
}

/**
 * Hand every stashed file to `handle`, oldest first, deleting each only once
 * it has been handled, so a failure leaves it (and the rest) for a retry.
 */
export async function consumeSharedFiles(
  cache: ShareCache,
  handle: (file: File) => Promise<unknown>,
): Promise<number> {
  const run = async () => {
    let count = 0;
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (response) {
        await handle(await fileFrom(response));
        count++;
      }
      await cache.delete(request);
    }
    return count;
  };
  // Two shells (a second share while one is open) must not both take the
  // same entry; the lock is origin-wide. Older browsers just run unlocked.
  const locks = globalThis.navigator?.locks;
  return locks ? locks.request(SHARE_CACHE, run) : run();
}
