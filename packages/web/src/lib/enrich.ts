/**
 * Bookmark enrichment: fill a bookmark's blank title/description/preview
 * image from the page's Open Graph metadata, fetched through Sockethub
 * (see link-metadata.ts).
 *
 * Follows the transcription pattern (AudioView): an async, best-effort
 * post-capture step that re-stores the item — the update flows to every
 * card reactively through the `items` store. Runs automatically after a
 * new link is captured, and on demand for existing bookmarks (per-card
 * button in the bookmark view, bulk action in the user menu).
 */

import type { BookmarkItem, InboxItem } from '@inbox-rs/rs-module';
import { get, writable } from 'svelte/store';
import { fetchLinkMetadata, type LinkMetadata } from './link-metadata';
import { items, storeItem } from './stores';

/** True when a fetch could still add something to this bookmark. */
export function needsEnrichment(item: BookmarkItem): boolean {
  return (
    !item.title ||
    item.title === item.url ||
    !item.description ||
    !item.ogImage ||
    !item.siteName
  );
}

/**
 * Merge fetched metadata into a bookmark, never clobbering what the user
 * (or the extension's richer DOM scrape) already provided: the title is
 * only replaced while it's still the URL fallback, and description/image/
 * site name/favicon only fill empty fields. Returns the updated copy, or
 * null when nothing new was learned.
 */
export function applyLinkMetadata(
  item: BookmarkItem,
  meta: LinkMetadata,
): BookmarkItem | null {
  const updated: BookmarkItem = { ...item };
  let changed = false;
  if (meta.title && (!item.title || item.title === item.url)) {
    updated.title = meta.title;
    changed = true;
  }
  if (meta.description && !item.description) {
    updated.description = meta.description;
    changed = true;
  }
  if (meta.image && !item.ogImage && !item.filePath) {
    updated.ogImage = meta.image;
    changed = true;
  }
  if (meta.siteName && !item.siteName) {
    updated.siteName = meta.siteName;
    changed = true;
  }
  if (meta.favicon && !item.favicon) {
    updated.favicon = meta.favicon;
    changed = true;
  }
  return changed ? updated : null;
}

/**
 * Fetch metadata for a bookmark and store the enriched copy. Returns
 * 'updated' when the item changed, 'none' when the page had nothing to add
 * (or we're offline / the item vanished meanwhile); rejects when the fetch
 * itself failed so interactive callers can offer a retry. Fire-and-forget
 * callers should `.catch()` — a capture must never fail because its
 * preview did.
 */
export async function enrichBookmark(
  item: BookmarkItem,
): Promise<'updated' | 'none'> {
  if (!navigator.onLine) return 'none';
  const meta = await fetchLinkMetadata(item.url);
  if (!meta) return 'none';
  // Re-read the live item: the user may have edited it during the fetch,
  // and merging into the *current* fields keeps their changes protected.
  // If it's gone (deleted or the capture was undone), storing again would
  // resurrect it — bail instead.
  const current = get(items)[item.id];
  if (!current || current.type !== 'bookmark' || current.url !== item.url) {
    return 'none';
  }
  const updated = applyLinkMetadata(current, meta);
  if (!updated) return 'none';
  await storeItem(updated);
  return 'updated';
}

export interface BulkEnrichProgress {
  done: number;
  total: number;
}

/** Non-null while a bulk enrichment pass is running (drives the menu UI). */
export const bulkEnrichProgress = writable<BulkEnrichProgress | null>(null);

/** How many metadata fetches to keep in flight during a bulk pass. */
const BULK_CONCURRENCY = 3;

/**
 * Enrich every existing bookmark that's still missing metadata. Returns a
 * summary for the completion toast, or null when a pass is already running.
 * Individual failures (dead links, pages Sockethub can't reach) are counted
 * and skipped — one bad URL shouldn't abort the backlog.
 */
export async function enrichAllBookmarks(): Promise<{
  updated: number;
  failed: number;
  total: number;
} | null> {
  if (get(bulkEnrichProgress)) return null;
  const candidates = Object.values(get(items)).filter(
    (item: InboxItem): item is BookmarkItem =>
      item.type === 'bookmark' && needsEnrichment(item),
  );
  const total = candidates.length;
  bulkEnrichProgress.set({ done: 0, total });
  let updated = 0;
  let failed = 0;
  try {
    const queue = [...candidates];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          if ((await enrichBookmark(item)) === 'updated') updated++;
        } catch {
          failed++;
        }
        bulkEnrichProgress.update((p) =>
          p ? { ...p, done: p.done + 1 } : p,
        );
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(BULK_CONCURRENCY, total) }, worker),
    );
  } finally {
    bulkEnrichProgress.set(null);
  }
  return { updated, failed, total };
}
