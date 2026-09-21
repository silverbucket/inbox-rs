/**
 * Total bytes the inbox occupies on the user's remoteStorage server.
 *
 * Only `/inbox/` is counted. Sharesome copies under `/public/shares/` are
 * left out: that folder is shared with other apps, so its size isn't ours
 * to claim — the UI says "in your inbox" for that reason.
 *
 * remotestoragejs's `getListing` drops `Content-Length` whenever caching is
 * on (it is, for all of `/inbox/`), so we read the server's folder
 * descriptions directly — the same Bearer-header approach as
 * `fetchFileWithAuth` — and walk them from the scope root. The tree is a
 * handful of folders (items, files, collections, …), so this is a few small
 * requests, not one per item.
 */

type FolderEntry = { 'Content-Length'?: number };
type FolderDescription = { items?: Record<string, FolderEntry | true> };

/**
 * Sum `Content-Length` over every document under `folder` (a path relative
 * to the storage root, with leading and trailing slashes).
 *
 * Returns null when the size can't be known: a request failed, or the server
 * speaks a pre-folder-description spec whose listings carry ETags only.
 * An absent folder (404) is simply empty.
 */
export async function fetchStorageUsage(
  href: string,
  token: string,
  folder = '/inbox/',
): Promise<number | null> {
  try {
    const url = href + folder.split('/').map(encodeURIComponent).join('/');
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 404) return 0;
    if (!resp.ok) return null;
    const { items } = (await resp.json()) as FolderDescription;
    if (!items) return null;
    const sizes = await Promise.all(
      Object.entries(items).map(([name, entry]) => {
        if (name.endsWith('/')) {
          return fetchStorageUsage(href, token, folder + name);
        }
        const size = entry === true ? undefined : entry['Content-Length'];
        return typeof size === 'number' ? size : null;
      }),
    );
    let total = 0;
    for (const size of sizes) {
      if (size === null) return null;
      total += size;
    }
    return total;
  } catch {
    return null;
  }
}

/** Human-readable byte count: `0 B`, `812 B`, `4.2 MB`, `1.3 GB`. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  // Compare what would be printed, not the raw value: 1048575 B rounds to
  // "1024.0 KB", which should read "1.0 MB".
  while (
    unit < units.length - 1 &&
    (unit === 0 ? value : Number(value.toFixed(1))) >= 1024
  ) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
