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

import {
  applySchedule,
  type BookmarkItem,
  eventSchedule,
  type InboxItem,
  imageExtension,
  isPlaceholderImage,
  type NoteItem,
  truncateTitle,
} from '@inbox-rs/rs-module';
import { get, writable } from 'svelte/store';
import { bookmarkUrlFromNoteBody } from './capture-detect';
import {
  canDownloadImages,
  DEFAULT_SOCKETHUB_ENDPOINT,
  downloadLinkImage,
  fetchLinkMetadata,
  type LinkMetadata,
} from './link-metadata';
import { items, removeFile, updateItem, userSettings } from './stores';
import { showToast } from './toast';
import { lacksTitle } from './triage';

export const LOCAL_LINK_PREVIEWS_KEY = 'inbox-rs:link-previews';
export const LOCAL_SOCKETHUB_URL_KEY = 'inbox-rs:sockethub-url';

/** Read a browser-local setting without failing in restricted storage contexts. */
function localSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Link previews are on unless the user turned them off. */
export function linkPreviewsEnabled(): boolean {
  return (
    get(userSettings).linkPreviews !== false &&
    localSetting(LOCAL_LINK_PREVIEWS_KEY) !== 'false'
  );
}

/** The user's own Sockethub endpoint when set, else the app default. */
/** Shared by every sockethub-backed feature (link previews, CalDAV). */
export function resolveSockethubEndpoint(): string {
  return (
    get(userSettings).sockethubUrl?.trim() ||
    localSetting(LOCAL_SOCKETHUB_URL_KEY)?.trim() ||
    DEFAULT_SOCKETHUB_ENDPOINT
  );
}

/** What the card says when a link preview fetch fails. */
export const LINK_PREVIEW_ERROR = 'Couldn’t load a preview for this link.';

/**
 * Turn low-level fetch failures into a technical diagnosis with a next step,
 * shown behind "More details" under {@link LINK_PREVIEW_ERROR}.
 */
export function describeLinkPreviewError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'Preview service timed out. Check the Sockethub URL.';
  }
  if (error instanceof TypeError) {
    return 'Couldn’t reach the preview service. Check its URL, CORS, and that it is running.';
  }
  const detail = error instanceof Error ? error.message.trim() : '';
  return detail
    ? `Preview service error: ${detail}`
    : 'Preview fetch failed. Check the Sockethub URL and try again.';
}

/** True when a fetch could still add something to this bookmark. */
export function needsEnrichment(item: BookmarkItem): boolean {
  return (
    lacksTitle(item) ||
    !item.description ||
    !item.ogImage ||
    isPlaceholderImage(item.ogImage) ||
    !item.siteName
  );
}

/**
 * The URL of a note that is nothing but a link — how quick-capture and the
 * share target save links, since they have no bookmark mode. Such notes
 * are treated as saved links everywhere previews are counted or fetched.
 */
export function linkNoteUrl(item: InboxItem): string | null {
  // Guard the body: older or foreign records may omit it.
  return item.type === 'note' && !item.isTodo && typeof item.body === 'string'
    ? bookmarkUrlFromNoteBody(item.body)
    : null;
}

/** True for bookmarks and link-only notes alike. */
export function isSavedLink(item: InboxItem): boolean {
  return item.type === 'bookmark' || linkNoteUrl(item) !== null;
}

/** True when a preview fetch could still add something to this saved link. */
export function needsLinkPreview(item: InboxItem): boolean {
  return item.type === 'bookmark'
    ? needsEnrichment(item)
    : linkNoteUrl(item) !== null;
}

/**
 * Turn a link-only note into a bookmark under the same id. The title is
 * reset to the URL (so enrichment may replace it) unless the user wrote
 * their own — i.e. it is neither the body- nor URL-derived fallback.
 */
export function noteToBookmark(note: NoteItem, url: string): BookmarkItem {
  // Derived titles end in "…" when cut; older ones were cut without it.
  const fallbackTitles = new Set(
    [note.body, url].flatMap((text) => [
      truncateTitle(text),
      text.slice(0, 50),
    ]),
  );
  const { body: _body, ...rest } = note;
  return {
    ...rest,
    type: 'bookmark',
    url,
    title: !note.title || fallbackTitles.has(note.title) ? url : note.title,
  };
}

/**
 * Merge fetched metadata into a bookmark, never clobbering what the user
 * (or the extension's richer DOM scrape) already provided: the title is
 * only replaced while it's still a stand-in (blank, the URL, or just the
 * site's name), and description/image/site name/favicon only fill empty
 * fields. Returns the updated copy, or
 * null when nothing new was learned.
 */
export function applyLinkMetadata(
  item: BookmarkItem,
  meta: LinkMetadata,
): BookmarkItem | null {
  let updated: BookmarkItem = { ...item };
  let changed = false;
  // The page's event time fills an unscheduled card only — a time the user
  // set by hand wins, like every other field here.
  const schedule = meta.event && !item.startsAt && eventSchedule(meta.event);
  if (schedule) {
    updated = applySchedule(updated, schedule);
    changed = true;
  }
  // An event-only page still names its event; better than a URL title.
  const title = meta.title || meta.event?.name;
  if (title && title !== item.title && lacksTitle(item)) {
    updated.title = title;
    changed = true;
  }
  if (meta.description && !item.description) {
    updated.description = meta.description;
    changed = true;
  }
  // A stored share card (share.redd.it, Amazon's share icon) counts as no
  // image, so the page's real one replaces it. The extension kept a local
  // copy of whatever og:image it saw, so a placeholder ogImage means the
  // local file is that same card: drop it too (enrichBookmark deletes it).
  const placeholder = isPlaceholderImage(item.ogImage);
  if (
    meta.image &&
    !isPlaceholderImage(meta.image) &&
    (placeholder || (!item.ogImage && !item.filePath))
  ) {
    updated.ogImage = meta.image;
    if (placeholder) {
      delete updated.filePath;
      delete updated.mimeType;
    }
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

/** What a preview fetch did, and what it left for the user to decide. */
export interface PreviewRefresh {
  /** 'skipped': the page was never read (previews off, offline, no reply). */
  status: 'updated' | 'none' | 'skipped';
  /**
   * A real image the page offers that differs from the one already saved.
   * It is never applied on its own: the saved image may be the only copy of
   * a page that has since changed, so the caller asks first and applies the
   * answer with {@link replaceBookmarkImage}.
   */
  image?: string;
}

/**
 * Fetch metadata for a bookmark and store the enriched copy, under the
 * fill-only rules of {@link applyLinkMetadata}. On top of that it reports a
 * different image the page now has, for the user to accept or decline.
 * Rejects when the fetch itself failed, so a dead link changes nothing.
 */
export async function refreshBookmark(
  item: BookmarkItem,
): Promise<PreviewRefresh> {
  if (!linkPreviewsEnabled() || !navigator.onLine) {
    return { status: 'skipped' };
  }
  const meta = await fetchLinkMetadata(item.url, resolveSockethubEndpoint());
  if (!meta) return { status: 'skipped' };
  // Read-merge-write inside the item's queue: the user may have edited it
  // during the fetch, and a save still landing must be merged against, not
  // overwritten. If it's gone (deleted or the capture was undone), storing
  // again would resurrect it — bail instead.
  let before: BookmarkItem | undefined;
  const updated = await updateItem(item.id, (current) => {
    if (!current || current.type !== 'bookmark' || current.url !== item.url) {
      return null;
    }
    before = current;
    return applyLinkMetadata(current, meta);
  });
  const latest = (updated as BookmarkItem | null) ?? before;
  const image =
    latest &&
    (latest.ogImage || latest.filePath) &&
    meta.image &&
    !isPlaceholderImage(meta.image) &&
    latest.ogImage !== meta.image
      ? meta.image
      : undefined;
  // Runs even when the page had nothing new: a bookmark saved before
  // images were kept gets its copy the next time its preview is fetched.
  // Best effort, as a preview must not fail because its image did.
  if (latest) {
    await keepBookmarkImage(latest).catch((e) => {
      console.warn('Saving the preview image failed:', latest.url, e);
    });
  }
  if (!updated) return { status: 'none', image };
  // The local copy of a replaced share card is now unreferenced.
  if (before?.filePath && !updated.filePath) void removeFile(before.filePath);
  // Background enrichment is otherwise silent; a date appearing on its own
  // would read as a glitch.
  if (updated.startsAt && !before?.startsAt) {
    showToast('Event time added from the page');
  }
  return { status: 'updated', image };
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
  const { status } = await refreshBookmark(item);
  return status === 'updated' ? 'updated' : 'none';
}

/** Where a bookmark's own copy of its preview image is stored. */
function localImagePath(id: string, mimeType: string): string | null {
  const ext = imageExtension(mimeType);
  return ext ? `files/${id}.${ext}` : null;
}

/** Download an image for a bookmark, or null when this server can't. */
async function downloadBookmarkImage(item: BookmarkItem, image: string) {
  const endpoint = resolveSockethubEndpoint();
  if (!(await canDownloadImages(endpoint))) return null;
  const file = await downloadLinkImage(item.url, image, endpoint);
  const filePath = localImagePath(item.id, file.mimeType);
  return filePath
    ? { filePath, mimeType: file.mimeType, data: file.data }
    : null;
}

/**
 * Store the bookmark's preview image next to it, so the card keeps its
 * image after the page or its image host is gone. True when a copy was
 * stored; false when there is nothing to copy, a copy already exists, the
 * server can't download images, or the bookmark changed meanwhile. Rejects
 * when the download itself failed.
 */
export async function keepBookmarkImage(item: BookmarkItem): Promise<boolean> {
  const image = item.ogImage;
  if (!image || item.filePath || isPlaceholderImage(image)) return false;
  const file = await downloadBookmarkImage(item, image);
  if (!file) return false;
  const updated = await updateItem(
    item.id,
    (current) =>
      current?.type === 'bookmark' &&
      current.url === item.url &&
      current.ogImage === image &&
      !current.filePath
        ? { ...current, filePath: file.filePath, mimeType: file.mimeType }
        : null,
    file.data,
  );
  return !!updated;
}

/**
 * Swap a bookmark's preview image for one the user picked after a refresh.
 * The new image is downloaded first and stored as the bookmark's own copy.
 * A bookmark that already has a local copy never trades it for a remote
 * link: when the new image can't be downloaded the saved one stays and the
 * result is 'kept'. 'gone' when the bookmark changed or vanished meanwhile.
 */
export async function replaceBookmarkImage(
  item: BookmarkItem,
  image: string,
): Promise<'replaced' | 'kept' | 'gone'> {
  const file = await downloadBookmarkImage(item, image).catch((e) => {
    console.warn('Downloading the new preview image failed:', image, e);
    return null;
  });
  let oldFile: string | undefined;
  let kept = false;
  const updated = await updateItem(
    item.id,
    (current) => {
      if (!current || current.type !== 'bookmark' || current.url !== item.url) {
        return null;
      }
      const { filePath, mimeType: _mimeType, ...rest } = current;
      if (!file && filePath) {
        kept = true;
        return null;
      }
      oldFile = filePath;
      return file
        ? {
            ...rest,
            ogImage: image,
            filePath: file.filePath,
            mimeType: file.mimeType,
          }
        : { ...rest, ogImage: image };
    },
    file?.data,
  );
  if (kept) return 'kept';
  if (!updated) return 'gone';
  if (oldFile && oldFile !== (updated as BookmarkItem).filePath) {
    void removeFile(oldFile);
  }
  return 'replaced';
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
 * Enrich every saved link that's still missing metadata: bookmarks, plus
 * link-only notes, which are first converted into bookmarks (as the card's
 * own "Fetch link preview" does). Returns a summary for the completion
 * toast, or null when a pass is already running. Individual failures (dead
 * links, pages Sockethub can't reach) are counted and skipped — one bad
 * URL shouldn't abort the backlog.
 */
export async function enrichAllBookmarks(): Promise<{
  updated: number;
  failed: number;
  total: number;
} | null> {
  if (get(bulkEnrichProgress)) return null;
  const candidates = Object.values(get(items)).filter(needsLinkPreview);
  const total = candidates.length;
  bulkEnrichProgress.set({ done: 0, total });
  let updated = 0;
  let failed = 0;
  try {
    const queue = [...candidates];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const url = item.type === 'bookmark' ? item.url : linkNoteUrl(item);
        try {
          let changed = false;
          let bookmark: BookmarkItem;
          if (item.type === 'bookmark') {
            bookmark = item;
          } else {
            // The queue holds snapshots taken before the pass started; a
            // sync may have edited or deleted this note while it waited
            // behind earlier fetches. Convert the live copy, and only
            // while it is still the same link-only note — the same
            // stale-write guard enrichBookmark applies.
            const converted = await updateItem(item.id, (current) =>
              current && linkNoteUrl(current) === url
                ? noteToBookmark(current as NoteItem, url as string)
                : null,
            );
            if (!converted) continue;
            bookmark = converted;
            changed = true;
          }
          if ((await enrichBookmark(bookmark)) === 'updated') changed = true;
          if (changed) updated++;
        } catch (e) {
          // Without this a bulk pass skips failing URLs with no trace of
          // why. Worded for the whole operation: the rejection may come
          // from the metadata fetch or from storing the enriched item.
          console.warn('Link preview enrichment failed:', url, e);
          failed++;
        } finally {
          bulkEnrichProgress.update((p) =>
            p ? { ...p, done: p.done + 1 } : p,
          );
        }
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
