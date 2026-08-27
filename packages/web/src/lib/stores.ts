import type {
  AppConfig,
  Collection,
  CollectionGroup,
  InboxItem,
  UserSettings,
} from '@inbox-rs/rs-module';
import { migrator, wrapCodeBlock } from '@inbox-rs/rs-module';
import type { Readable, Writable } from 'svelte/store';
import { derived, get, writable } from 'svelte/store';
import { cleanForStorage } from './clean-for-storage';
import { pinItemsFirst } from './collection-todos';
import { todayStart } from './now';
import rs, { fetchFileBlobUrl } from './rs';
import { compareByDueTime, isDueTodayOrOverdue } from './schedule';

function getInbox() {
  return rs.inbox;
}

/**
 * Like getInbox(), but throws a descriptive error instead of letting callers
 * hit a TypeError on undefined. Used by write paths so a failed module
 * registration surfaces as a clear message rather than a crash mid-operation.
 */
function requireInbox() {
  const inbox = getInbox();
  if (!inbox) throw new Error('Inbox storage module is not available');
  return inbox;
}

/** Blob URLs for files that were just uploaded (available before remote sync completes) */
export const blobUrls = writable<Record<string, string>>({});

/**
 * File paths whose bytes could not be loaded while *connected* — i.e. the
 * remote returned no usable file (a 404, or a fetch error) and there was no
 * local copy either. Distinct from "not loaded yet": a path only lands here
 * after a genuine online failure. Grid cards use it to fall back from a
 * missing thumbnail to the full image (see ImageCard), so a thumb that was
 * never uploaded — or failed its best-effort upload — doesn't leave a
 * permanently blank card when the original image is perfectly fetchable.
 */
export const blobLoadFailures = writable<Set<string>>(new Set());

function markBlobLoadFailed(filePath: string) {
  blobLoadFailures.update((s) => {
    if (s.has(filePath)) return s;
    const next = new Set(s);
    next.add(filePath);
    return next;
  });
}

function clearBlobLoadFailed(filePath: string) {
  blobLoadFailures.update((s) => {
    if (!s.has(filePath)) return s;
    const next = new Set(s);
    next.delete(filePath);
    return next;
  });
}

export const connected = writable(false);
export const syncing = writable(false);

function readStoredUserAddress(): string {
  try {
    // remoteStorage.js persists the user address in this key
    const settings = JSON.parse(
      localStorage.getItem('remotestorage:wireclient') ?? '{}',
    );
    return (
      settings?.userAddress ??
      localStorage.getItem('inbox-rs:userAddress') ??
      ''
    );
  } catch {
    return '';
  }
}

export const userAddress = writable<string>(readStoredUserAddress());
export const items = writable<Record<string, InboxItem>>({});
/**
 * Un-normalized view of items straight from storage. Used for migration
 * detection so legacy types (e.g. `code-snippet`) are visible to the migrator
 * even though `items` presents them normalized to their current type.
 */
const rawItems = writable<Record<string, object>>({});
export const appConfig = writable<AppConfig>({});
export const userSettings = writable<UserSettings>({});
export const collections = writable<Record<string, Collection>>({});
export const groups = writable<Record<string, CollectionGroup>>({});
const INITIAL_MIGRATION_ALERT_TIMEOUT_MS = 2500;

function stripMigrationVersion<T>(doc: T): T {
  if (!doc || typeof doc !== 'object') return doc;
  const { _migrateVersion: _, ...rest } = doc as Record<string, unknown>;
  return rest as T;
}

/**
 * Memoized per document *reference*: `rawItems` entries are replaced (not
 * mutated) whenever an item changes, so identity is a safe cache key. Without
 * this, the derived count below re-runs migrateDocument + two JSON.stringify
 * passes over EVERY item on EVERY change event — during a first sync of N
 * items that's O(N²) (~9M ops at 3k items) and freezes the UI.
 */
const migrationCheckCache = new WeakMap<object, boolean>();

function requiresContentMigration(doc: object): boolean {
  const cached = migrationCheckCache.get(doc);
  if (cached !== undefined) return cached;
  const migrated = migrator.migrateDocument('items', doc as InboxItem);
  const result =
    migrated !== doc &&
    JSON.stringify(stripMigrationVersion(migrated)) !==
      JSON.stringify(stripMigrationVersion(doc));
  migrationCheckCache.set(doc, result);
  return result;
}

/** Count only docs whose non-version content would actually change under migration */
const rawPendingMigrationCount = derived(rawItems, ($rawItems) => {
  const docs = Object.values($rawItems);
  if (docs.length === 0) return 0;
  let count = 0;
  for (const doc of docs) {
    if (requiresContentMigration(doc)) count++;
  }
  return count;
});
const migrationAlertReady = writable(false);
let migrationAlertTimeout: ReturnType<typeof setTimeout> | null = null;

function clearMigrationAlertTimeout() {
  if (!migrationAlertTimeout) return;
  clearTimeout(migrationAlertTimeout);
  migrationAlertTimeout = null;
}

function resetMigrationAlertReadiness() {
  clearMigrationAlertTimeout();
  migrationAlertReady.set(false);
}

function scheduleMigrationAlertFallback() {
  clearMigrationAlertTimeout();
  migrationAlertTimeout = setTimeout(() => {
    migrationAlertTimeout = null;
    migrationAlertReady.set(true);
  }, INITIAL_MIGRATION_ALERT_TIMEOUT_MS);
}

function markMigrationAlertReady() {
  if (get(migrationAlertReady)) return;
  clearMigrationAlertTimeout();
  migrationAlertReady.set(true);
}

/** Visible count for the app after the initial connect/sync state settles */
export const pendingMigrationCount = derived(
  [rawPendingMigrationCount, migrationAlertReady],
  ([$rawPendingMigrationCount, $migrationAlertReady]) =>
    $migrationAlertReady ? $rawPendingMigrationCount : 0,
);

// ---- Generic helpers ----

async function loadEntities<T extends { id: string }>(
  fetchAll: () => Promise<Record<string, unknown>>,
  store: Writable<Record<string, T>>,
  arrayField?: keyof T,
): Promise<boolean> {
  // Callers pass arrow functions that close over the module themselves; the
  // guard only ensures the module registered before we invoke them.
  if (!getInbox()) return false;
  try {
    const all = await fetchAll();
    const valid: Record<string, T> = {};
    for (const [key, raw] of Object.entries(all)) {
      if (raw && typeof raw === 'object' && 'id' in raw && (raw as T).id) {
        const entity = raw as T;
        if (key !== entity.id) continue;
        if (arrayField) {
          valid[key] = {
            ...entity,
            [arrayField]: Array.isArray(entity[arrayField])
              ? entity[arrayField]
              : [],
          };
        } else {
          valid[key] = entity;
        }
      }
    }
    // Merge into the store rather than replacing — the change handler may
    // have already inserted entries during the await window, and a .set()
    // would silently drop them.
    store.update((current) => ({ ...current, ...valid }));
    return true;
  } catch (e) {
    console.error('[inbox] loadEntities failed:', e);
    return false;
  }
}

function orderedDerived<T extends { id: string; createdAt: string }>(
  entityStore: Readable<Record<string, T>>,
  configOrderKey: 'collectionsOrder' | 'groupsOrder',
): Readable<T[]> {
  return derived([entityStore, appConfig], ([$entities, $config]) => {
    return sortWithConfiguredOrder(
      Object.values($entities),
      $config[configOrderKey],
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  });
}

async function removeFromOrderConfig(
  id: string,
  key: 'collectionsOrder' | 'groupsOrder',
) {
  const currentOrder = get(appConfig)[key] ?? [];
  if (currentOrder.includes(id)) {
    await updateConfig({ [key]: currentOrder.filter((x: string) => x !== id) });
  }
}

// ---- Loaders ----

function normalizeLoadedItem(item: object): InboxItem {
  const candidate = item as Record<string, unknown>;
  if (candidate.type === 'code-snippet') {
    const { language, body, ...rest } = candidate;
    return {
      ...rest,
      type: 'note',
      body: wrapCodeBlock(body, language),
    } as InboxItem;
  }
  return candidate as unknown as InboxItem;
}

async function loadItems() {
  const inbox = getInbox();
  if (!inbox) {
    console.warn('[inbox] loadItems: inbox module not available');
    return;
  }
  try {
    const all = await inbox.getAll();
    const valid: Record<string, InboxItem> = {};
    const rawValid: Record<string, object> = {};
    for (const [key, item] of Object.entries(all)) {
      if (
        item &&
        typeof item === 'object' &&
        'id' in item &&
        typeof (item as { id?: unknown }).id === 'string'
      ) {
        // Only trust canonically-addressed item records. This avoids rendering
        // duplicate/stale documents that may still exist under malformed keys.
        if (key !== (item as { id: string }).id) continue;
        rawValid[key] = item;
        valid[key] = normalizeLoadedItem(item);
      }
    }
    // Merge rather than overwrite. The RS change handler can populate `items`
    // optimistically (via 'local' cache-replay events) before getAll() resolves;
    // calling .set() with the getAll result would clobber any items that were
    // added by storeItem() while we were awaiting. We trust getAll's snapshot
    // for entries it returned, but preserve any keys it didn't.
    rawItems.update((current) => ({ ...current, ...rawValid }));
    items.update((current) => ({ ...current, ...valid }));
  } catch (e) {
    console.error('[inbox] loadItems failed:', e);
  }
}

async function loadConfig() {
  const inbox = getInbox();
  if (!inbox) return;
  try {
    const config = await inbox.getConfig();
    if (config && typeof config === 'object') {
      appConfig.set(config);
    }
  } catch (e) {
    console.error('[inbox] loadConfig failed:', e);
  }
}

async function loadUserSettings() {
  const inbox = getInbox();
  if (!inbox) return;
  try {
    const settings = await inbox.getUserSettings();
    if (settings && typeof settings === 'object') {
      userSettings.set(settings);
    }
  } catch (e) {
    console.error('[inbox] loadUserSettings failed:', e);
  }
}

async function loadCollections() {
  const inbox = getInbox();
  return loadEntities<Collection>(
    () => inbox.getAllCollections(),
    collections,
    'itemIds',
  );
}

async function loadGroups() {
  const inbox = getInbox();
  return loadEntities<CollectionGroup>(
    () => inbox.getAllGroups(),
    groups,
    'collectionIds',
  );
}

// Single in-flight load promise so the cached preload (queueMicrotask at
// module init) and the post-connect reload don't run concurrent loaders
// against the same five stores. Each entry-point waits for any pending load
// to settle before kicking off its own.
let inFlightLoad: Promise<void> | null = null;

function runLoaders(): Promise<void> {
  return Promise.all([
    loadItems(),
    loadConfig(),
    loadUserSettings(),
    loadCollections(),
    loadGroups(),
  ]).then(() => undefined);
}

async function loadCachedData() {
  // Skip if the connect handler has already taken over — its load is
  // authoritative once we're online.
  if (get(connected)) return;
  if (inFlightLoad) {
    await inFlightLoad;
    return;
  }
  inFlightLoad = runLoaders();
  try {
    await inFlightLoad;
    markMigrationAlertReady();
  } finally {
    inFlightLoad = null;
  }
}

async function loadConnectedData() {
  resetMigrationAlertReadiness();
  if (inFlightLoad) {
    // Let the cached load settle before starting a fresh one so we don't
    // double-read the same stores in parallel.
    try {
      await inFlightLoad;
    } catch {
      /* errors handled inside loaders */
    }
  }
  inFlightLoad = runLoaders();
  try {
    await inFlightLoad;
    scheduleMigrationAlertFallback();
  } finally {
    inFlightLoad = null;
  }
}

// Debounced sync indicator: stays visible for at least 1 second to avoid flicker
let syncTimeout: ReturnType<typeof setTimeout> | null = null;
let syncVisibleUntil = 0;

function showSync() {
  syncing.set(true);
  syncVisibleUntil = Date.now() + 1000;
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = null;
}

function hideSync() {
  const remaining = syncVisibleUntil - Date.now();
  if (remaining > 0) {
    if (!syncTimeout) {
      syncTimeout = setTimeout(() => {
        syncTimeout = null;
        syncing.set(false);
      }, remaining);
    }
  } else {
    syncing.set(false);
  }
}

rs.on('wire-busy', showSync);
rs.on('wire-done', () => {
  hideSync();
  markMigrationAlertReady();
});
rs.on('sync-done', () => {
  hideSync();
  markMigrationAlertReady();
});

rs.on('error', (e: unknown) => console.warn('[inbox] rs:error', e));

rs.on('connected', async () => {
  connected.set(true);
  // The connected user's address lives on `rs.remote` once auth completes;
  // fall back to localStorage so we have something to display before sync.
  const remote = rs.remote as { userAddress?: string } | undefined;
  const addr =
    remote?.userAddress || localStorage.getItem('inbox-rs:userAddress') || '';
  userAddress.set(addr);
  await loadConnectedData();
});

rs.on('disconnected', () => {
  // Revoke all blob URLs to prevent memory leaks across reconnects / long sessions.
  // Bump the generation so any in-flight loadFileBlobUrl promises from
  // before this disconnect are ignored when they resolve (prevents stale
  // blob URLs from being re-added after cleanup).
  blobLoadGeneration++;
  const currentBlobs = get(blobUrls);
  for (const url of Object.values(currentBlobs)) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore revoke errors during shutdown
    }
  }
  blobUrls.set({});
  blobLruOrder.length = 0;
  pendingBlobLoads.clear();
  revokedBlobPaths.clear();

  connected.set(false);
  userAddress.set('');
  localStorage.removeItem('inbox-rs:userAddress');
  clearMigrationAlertTimeout();
  migrationAlertReady.set(false);
  items.set({});
  rawItems.set({});
  appConfig.set({});
  userSettings.set({});
  collections.set({});
  groups.set({});
});

// Wait for `ready` before getAll() — earlier calls sit in `_pendingGPD`
// until features finish loading, which means a stalled IDB init drags the
// preload into its 10s timeout even with `maxAge: false`. RS replays `ready`
// for late listeners, so HMR still triggers this on module re-run.
rs.on('ready', () => {
  void loadCachedData();
});

export async function runAllMigrations() {
  const inbox = getInbox();
  if (!inbox) return;
  try {
    await inbox.runAllMigrations();
  } catch (e) {
    console.error('[inbox] migration failed:', e);
  }
  await loadItems();
}

export async function updateConfig(patch: Partial<AppConfig>) {
  const inbox = getInbox();
  if (!inbox) throw new Error('Cannot update config: storage not connected');
  const currentConfig = get(appConfig);
  const updated = { ...currentConfig, ...patch };
  appConfig.set(updated);
  try {
    await inbox.setConfig(cleanForStorage(updated));
  } catch (e) {
    appConfig.set(currentConfig);
    console.error('[inbox] failed to persist config update:', e);
    throw e;
  }
}

export async function updateUserSettings(patch: Partial<UserSettings>) {
  const inbox = getInbox();
  if (!inbox)
    throw new Error('Cannot update user settings: storage not connected');
  const current = get(userSettings);
  const updated = { ...current, ...patch };
  userSettings.set(updated);
  try {
    await inbox.setUserSettings(cleanForStorage(updated));
  } catch (e) {
    userSettings.set(current);
    console.error('[inbox] failed to persist user settings:', e);
    throw e;
  }
}

// Handle incoming remote changes per-item rather than reloading full
// collections with getAll(). RS.js fires a `change` event for each item
// during a sync cycle — we parse relativePath to route each change to the
// correct store. This avoids redundant cache reads when many items arrive
// at once (e.g. bulk image sync from another device).
//
// Local writes already update stores optimistically (see storeItem,
// deleteItem, etc.), so we skip 'window' origin events to avoid duplicates.
// getAll() is only used for the initial load on connect.
//
// See: https://remotestorage.io/rs.js/docs/api/baseclient/classes/BaseClient.html#change-events
const inboxRef = getInbox();
if (inboxRef) {
  // The change event payload is documented in remotestoragejs but typed as
  // `unknown` on the public API. Narrow to the fields we actually read.
  type ChangeEvent = {
    origin?: string;
    relativePath?: string;
    newValue?: unknown;
  };
  // Item change events are buffered and flushed as ONE store update per
  // window. RS fires a separate `change` event for every item a sync cycle
  // delivers; applying each one individually spreads the whole `items`
  // record and re-runs every derived store (sortedItems sort, collectionItems
  // rebuild, migration recount) per event — O(N²) during a bulk sync. A 50ms
  // window coalesces a sync burst into a handful of updates while staying
  // imperceptible for a single incoming change. Collections/groups/config
  // change rarely and are still applied immediately below.
  const pendingItemChanges = new Map<string, object | null>(); // null = delete
  let itemFlushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushItemChanges() {
    itemFlushTimer = null;
    if (pendingItemChanges.size === 0) return;
    const batch = new Map(pendingItemChanges);
    pendingItemChanges.clear();
    rawItems.update((current) => {
      const next = { ...current };
      for (const [key, value] of batch) {
        if (value) next[key] = value;
        else delete next[key];
      }
      return next;
    });
    items.update((current) => {
      const next = { ...current };
      for (const [key, value] of batch) {
        if (value) next[key] = normalizeLoadedItem(value);
        else delete next[key];
      }
      return next;
    });
  }

  function queueItemChange(key: string, value: object | null) {
    pendingItemChanges.set(key, value);
    if (itemFlushTimer === null) {
      itemFlushTimer = setTimeout(flushItemChanges, 50);
    }
  }

  inboxRef.onChange((rawEvent: unknown) => {
    const event = rawEvent as ChangeEvent;
    if (!event || event.origin === 'window') return;
    const path: string = event.relativePath || '';
    const value = event.newValue;

    if (path.startsWith('items/')) {
      const key = path.slice('items/'.length);
      if (value && typeof value === 'object' && 'id' in value) {
        if (key !== (value as { id: string }).id) return;
        queueItemChange(key, value);
      } else if (!value) {
        queueItemChange(key, null);
      }
    } else if (path.startsWith('collections/')) {
      const key = path.slice('collections/'.length);
      if (value && typeof value === 'object' && 'id' in value) {
        const col = value as Collection;
        // Normalize itemIds — may be missing if written by another client
        collections.update((current) => ({
          ...current,
          [key]: {
            ...col,
            itemIds: Array.isArray(col.itemIds) ? col.itemIds : [],
          },
        }));
      } else if (!value) {
        collections.update((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    } else if (path.startsWith('groups/')) {
      const key = path.slice('groups/'.length);
      if (value && typeof value === 'object' && 'id' in value) {
        const grp = value as CollectionGroup;
        // Normalize collectionIds — may be missing if written by another client
        groups.update((current) => ({
          ...current,
          [key]: {
            ...grp,
            collectionIds: Array.isArray(grp.collectionIds)
              ? grp.collectionIds
              : [],
          },
        }));
      } else if (!value) {
        groups.update((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    } else if (path === 'config/app') {
      if (value && typeof value === 'object') {
        appConfig.set(value as AppConfig);
      }
    } else if (path === 'config/user') {
      if (value && typeof value === 'object') {
        userSettings.set(value as UserSettings);
      }
    }
    // File paths (e.g. files/photo.jpg) are ignored here — binary data
    // is fetched on demand via loadFileBlobUrl when components render.
  });
}

// Request a check for remote changes when the tab returns to foreground.
// This is the correct use of startSync() — local writes push automatically,
// but we need to explicitly ask for remote changes after being backgrounded.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && rs.remote?.connected) {
    rs.startSync();
  }
});

function sortWithConfiguredOrder<T extends { id: string }>(
  entities: T[],
  order: string[] | undefined,
  fallbackCompare: (a: T, b: T) => number,
): T[] {
  const orderIndex = order?.length
    ? new Map(order.map((id, index) => [id, index]))
    : undefined;

  // Sort a copy — callers hold references to the arrays they pass in, and an
  // in-place sort here is an easy source of accidental store mutation.
  return [...entities].sort((a, b) => {
    if (orderIndex) {
      const aIndex = orderIndex.get(a.id);
      const bIndex = orderIndex.get(b.id);
      if (aIndex !== undefined || bIndex !== undefined) {
        if (aIndex === undefined) return 1;
        if (bIndex === undefined) return -1;
        if (aIndex !== bIndex) return aIndex - bIndex;
      }
    }

    return fallbackCompare(a, b);
  });
}

// ---- Derived stores ----

// Placement semantics:
//   - item.collectionId set: item is filed in that real collection.
//   - reference item without collectionId: item lives in Inbox.
//   - todo without collectionId: item is unfiled and appears on the Todos page.
// There is no automatic collection/group bucket for unfiled items.

/** Inbox reference items: non-todos with no collectionId. */
export const sortedItems = derived(items, ($items) => {
  return pinItemsFirst(
    Object.values($items)
      .filter(
        (i) => !i.isTodo && i.type !== 'todo' && !i.collectionId && !i.archived,
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
  );
});

/**
 * Inbox reference cards archived by adding them to a calendar — triage
 * complete, the calendar owns them. Shown in the Inbox's collapsed archived
 * section (newest archive first); removing the calendar entry un-archives.
 */
export const archivedItems = derived(items, ($items) => {
  return Object.values($items)
    .filter(
      (i) => !i.isTodo && i.type !== 'todo' && !i.collectionId && !!i.archived,
    )
    .sort(
      (a, b) =>
        new Date(b.archivedAt ?? b.createdAt).getTime() -
        new Date(a.archivedAt ?? a.createdAt).getTime(),
    );
});

/**
 * Unfiled todos — every todo without a `collectionId`. Sorted open-first (respecting
 * `todosGlobalOrder`) then completed (by `completedAt` desc).
 *
 * `todosGlobalOrder` is the single source of truth for todo ordering across
 * the flat `/todos` page. Reordering unfiled todos from a focused surface goes
 * through `reorderUnfiledTodos`, which splices only unfiled slots so the filed
 * todos keep their global positions.
 *
 * Named `todoItems` for backwards compatibility with callers
 * (CollectionItemPicker, test suite) that use this store for unfiled todos.
 */
export const todoItems = derived(
  [items, appConfig, todayStart],
  ([$items, $config, $todayStart]) => {
    const all = Object.values($items).filter(
      (i) => (i.isTodo || i.type === 'todo') && !i.collectionId && !i.archived,
    );
    const completed = all.filter((i) => i.completed);

    const open = pinDueTodos(
      pinItemsFirst(
        sortWithConfiguredOrder(
          all.filter((i) => !i.completed),
          $config.todosGlobalOrder,
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
      ),
      $todayStart,
    );

    // Completed sorted by completedAt desc
    completed.sort(
      (a, b) =>
        new Date(b.completedAt ?? b.createdAt).getTime() -
        new Date(a.completedAt ?? a.createdAt).getTime(),
    );

    return [...open, ...completed];
  },
);

export const collectionItems = derived(
  [items, collections],
  ([$items, $collections]) => {
    const result: Record<string, InboxItem[]> = {};
    const itemMap = new Map(Object.values($items).map((i) => [i.id, i]));
    for (const [cid, col] of Object.entries($collections)) {
      result[cid] = col.itemIds
        .map((id) => itemMap.get(id))
        .filter(
          (i): i is InboxItem => i !== undefined && i.collectionId === cid,
        );
    }
    return result;
  },
);

// ---- File blob URL loading ----

/** Incremented on full blob URL revocation (e.g. disconnect) to invalidate in-flight loads. */
let blobLoadGeneration = 0;
const pendingBlobLoads = new Map<string, number>();

/**
 * Cap on how many blob URLs stay alive at once. Each entry pins the file's
 * full bytes in memory, and nothing else ever revokes them during a session —
 * a long browse through a media-heavy inbox would otherwise accumulate
 * hundreds of MB. Evicted paths simply reload on next view (cheap: the bytes
 * stay in the RS local cache, only the in-memory Blob is dropped). The cap is
 * generous enough that anything on screen — including the Lightbox's current
 * image — is effectively never the eviction victim.
 */
const BLOB_CACHE_MAX = 150;
/** filePaths in least-recently-used order (most recent last). */
const blobLruOrder: string[] = [];

function touchBlobLru(filePath: string) {
  const i = blobLruOrder.indexOf(filePath);
  if (i >= 0) blobLruOrder.splice(i, 1);
  blobLruOrder.push(filePath);
  while (blobLruOrder.length > BLOB_CACHE_MAX) {
    const evict = blobLruOrder.shift();
    if (!evict) break;
    const url = get(blobUrls)[evict];
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
      blobUrls.update((current) => {
        const next = { ...current };
        delete next[evict];
        return next;
      });
    }
  }
}

function dropBlobLru(filePath: string) {
  const i = blobLruOrder.indexOf(filePath);
  if (i >= 0) blobLruOrder.splice(i, 1);
}
/** Paths for which we have explicitly revoked (via deleteItem) so in-flight loads don't re-insert. */
const revokedBlobPaths = new Set<string>();

/**
 * Resolve a file's bytes to a blob URL from the best available source.
 *
 * When connected we fetch from the remote over authenticated HTTP. Otherwise —
 * or when the remote 404s because the file was captured offline and hasn't
 * synced yet — we read it from the local remoteStorage cache, where `store()`
 * writes the bytes regardless of connection state. Without this fallback, files
 * captured while disconnected vanish on reload even though their bytes (and
 * metadata) are sitting in the cache.
 */
async function resolveFileBlobUrl(
  filePath: string,
  mimeType?: string,
): Promise<string | null> {
  // Network first when connected. We deliberately do NOT read remoteStorage's
  // local cache before the remote for binaries: remotestorage.js's sync layer
  // corrupts a *remotely-fetched* binary body by running it through a
  // non-fatal UTF-8 decode, so bytes like 0x89 (a PNG's first byte) come back
  // as U+FFFD (0xFD) with the length shifted. The loss is not recoverable
  // (`recoverLegacyBinaryStringEncoding` only reverses the lossless legacy
  // shapes), so a device that never *wrote* the file itself — i.e. any device
  // other than the one that captured it — would render a broken image from
  // cache. `fetchFileWithAuth` reads the raw response bytes and is always
  // faithful. The extra fetch is deduped within a session by the in-memory
  // `blobUrls` LRU cache, so a given path is only fetched once per session.
  if (get(connected)) {
    const url = await fetchFileBlobUrl(filePath, mimeType);
    if (url) return url;
  }
  // Offline, or the remote 404'd because the file was captured on this device
  // and hasn't synced yet: read the local cache, where `store()` writes the
  // bytes regardless of connection state. This copy is faithful because *we*
  // wrote the raw ArrayBuffer into it — it never went through the sync layer's
  // corrupting decode. Without this fallback, offline-captured files would
  // vanish on reload even though their bytes are sitting in the cache.
  const inbox = getInbox();
  if (inbox) {
    try {
      const cached = await inbox.getFile(filePath);
      if (cached?.data) {
        // Prefer the caller's mimeType, and strip any `; charset=...` suffix
        // from the cached type — files pulled from the remote by the sync
        // layer can carry 5apps' `; charset=binary` echo, which Chrome
        // refuses to render as an <img> blob.
        const cleanType =
          mimeType?.trim() ||
          (cached.mimeType || '').split(';')[0].trim() ||
          '';
        const blob = new Blob([cached.data], { type: cleanType });
        return URL.createObjectURL(blob);
      }
    } catch {
      // No cached copy either — give up (returns null → placeholder).
    }
  }
  return null;
}

/**
 * Fetch a file and create a blob URL, stored in blobUrls for reactive display.
 * No-ops if already loaded or in progress. Components should call this on mount.
 * Reads from the remote when connected, otherwise from the local cache (see
 * resolveFileBlobUrl) so offline-captured files still render.
 *
 * A generation number is captured at start time. After a disconnect (or other
 * full revocation), the generation is bumped so stale promises cannot
 * re-populate blobUrls with URLs created after cleanup.
 */
export function loadFileBlobUrl(filePath: string, mimeType?: string): void {
  if (!filePath) return;
  // A new explicit load attempt clears any prior delete tombstone for this path.
  revokedBlobPaths.delete(filePath);
  if (get(blobUrls)[filePath] || pendingBlobLoads.has(filePath)) return;
  const gen = blobLoadGeneration;
  pendingBlobLoads.set(filePath, gen);
  resolveFileBlobUrl(filePath, mimeType)
    .then((url) => {
      if (!url) {
        // A null result while connected is a genuine failure (remote 404 or
        // fetch error, and no local copy) — record it so grid cards can fall
        // back from a missing thumbnail to the full image. While offline it
        // just means "not available yet"; the `$connected` re-run retries.
        if (get(connected)) markBlobLoadFailed(filePath);
        return;
      }
      clearBlobLoadFailed(filePath);
      // Ignore (and revoke) results that are stale due to disconnect, delete, etc.
      if (
        pendingBlobLoads.get(filePath) !== gen ||
        revokedBlobPaths.has(filePath)
      ) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
        return;
      }
      const old = get(blobUrls)[filePath];
      if (old) URL.revokeObjectURL(old);
      blobUrls.update((current) => ({ ...current, [filePath]: url }));
      touchBlobLru(filePath);
    })
    .finally(() => {
      if (pendingBlobLoads.get(filePath) === gen) {
        pendingBlobLoads.delete(filePath);
      }
    });
}

// ---- Item operations ----

export async function storeItem(
  item: InboxItem,
  fileData?: ArrayBuffer,
  thumbData?: ArrayBuffer,
) {
  const inbox = requireInbox();
  const cleanItem = cleanForStorage(item);
  await inbox.store(cleanItem, fileData, thumbData);
  if (fileData && 'filePath' in item && item.filePath && 'mimeType' in item) {
    const blob = new Blob([fileData], {
      type: (item as { mimeType?: string }).mimeType,
    });
    const url = URL.createObjectURL(blob);
    blobUrls.update((current) => ({
      ...current,
      [item.filePath as string]: url,
    }));
    touchBlobLru(item.filePath as string);
  }
  // Register the freshly generated thumbnail too, so the grid card shows it
  // immediately without a round trip through the loader.
  if (thumbData && 'thumbPath' in item && item.thumbPath) {
    const url = URL.createObjectURL(
      new Blob([thumbData], {
        type: (item as { thumbMimeType?: string }).thumbMimeType,
      }),
    );
    blobUrls.update((current) => ({
      ...current,
      [item.thumbPath as string]: url,
    }));
    touchBlobLru(item.thumbPath as string);
  }
  rawItems.update((current) => ({
    ...current,
    [cleanItem.id]: cleanItem as object,
  }));
  items.update((current) => ({ ...current, [cleanItem.id]: cleanItem }));
}

/** Toggle an item's top-of-list priority while preserving every other field. */
export async function setItemPinned(item: InboxItem, pinned: boolean) {
  await storeItem({ ...item, pinned });
}

/**
 * Revoke and forget a single stored file's in-memory blob URL, and clear its
 * LRU / in-flight / revoked bookkeeping. Shared by deleteItem and removeFile.
 */
function releaseBlobPath(path: string) {
  const existing = get(blobUrls)[path];
  if (existing) {
    try {
      URL.revokeObjectURL(existing);
    } catch {
      // ignore
    }
    blobUrls.update((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
  }
  dropBlobLru(path);
  // Drop any in-flight load for this specific file (no global gen bump needed).
  pendingBlobLoads.delete(path);
  // Mark as revoked so a concurrent in-flight load for this exact path is
  // ignored on resolution.
  revokedBlobPaths.add(path);
}

/**
 * Delete a single stored file by path (e.g. an orphaned thumbnail left behind
 * when an image edit produced no new thumbnail) and release its blob URL.
 * Best-effort: a storage failure is logged, not thrown, so it never fails the
 * surrounding save.
 */
export async function removeFile(path: string) {
  if (!path) return;
  try {
    await requireInbox().removeFile(path);
  } catch (e) {
    console.error('[inbox] removeFile failed:', path, e);
  }
  releaseBlobPath(path);
}

export async function deleteItem(id: string, item?: InboxItem) {
  const inbox = requireInbox();
  await inbox.remove(id, item);

  // Revoke and remove any associated blob URLs (original + thumbnail) to
  // prevent memory leaks. All current callers pass the full item; we also do
  // a defensive lookup.
  const stored = get(items)[id] as
    | { filePath?: string; thumbPath?: string }
    | undefined;
  const asFileItem = item as
    | { filePath?: string; thumbPath?: string }
    | undefined;
  for (const path of [
    asFileItem?.filePath || stored?.filePath,
    asFileItem?.thumbPath || stored?.thumbPath,
  ]) {
    if (typeof path !== 'string' || !path) continue;
    releaseBlobPath(path);
  }

  rawItems.update((current) => {
    const next = { ...current };
    for (const key of Object.keys(next)) {
      if ((next[key] as { id?: string }).id === id) {
        delete next[key];
        break;
      }
    }
    return next;
  });
  items.update((current) => {
    const next = { ...current };
    for (const key of Object.keys(next)) {
      if (next[key].id === id) {
        delete next[key];
        break;
      }
    }
    return next;
  });
}

// ---- Collection operations ----

export async function storeCollection(collection: Collection) {
  const inbox = requireInbox();
  const clean = cleanForStorage(collection);
  await inbox.storeCollection(clean);
  collections.update((current) => ({ ...current, [clean.id]: clean }));
}

export async function setItemArchived(id: string, archived: boolean) {
  const item = get(items)[id];
  if (!item) return;
  await storeItem({
    ...item,
    archived: archived || undefined,
    archivedAt: archived ? new Date().toISOString() : undefined,
    archiveReason: archived ? 'manual' : undefined,
  });
}

export async function setCollectionArchived(id: string, archived: boolean) {
  const collection = get(collections)[id];
  if (!collection) return;
  await storeCollection({
    ...collection,
    archived: archived || undefined,
    archivedAt: archived ? new Date().toISOString() : undefined,
  });
}

/**
 * Delete a collection. Refuses if the collection still contains items — the
 * caller is expected to either move items out (drag/drop, picker) or delete
 * them first. This mirrors `deleteGroup`'s "must be empty" rule and avoids
 * silently unfiling user-filed items on a delete tap. Returns `true` on
 * success, `false` when the delete was refused.
 *
 * Items are matched by the live `collectionId` on each item rather than the
 * collection's `itemIds` array — that array can drift out of sync if a write
 * was interrupted, and the items themselves are the source of truth for
 * placement.
 */
export async function deleteCollection(id: string): Promise<boolean> {
  const inbox = requireInbox();
  const collection = get(collections)[id];
  if (!collection) return false;

  const allItems = get(items);
  const hasItems = Object.values(allItems).some((i) => i.collectionId === id);
  if (hasItems) {
    console.warn(
      '[inbox] cannot delete collection with items — remove them first',
    );
    return false;
  }

  const prevCollections = get(collections);
  try {
    await inbox.removeCollection(id);
    collections.update((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    await removeFromOrderConfig(id, 'collectionsOrder');
    return true;
  } catch (e) {
    collections.set(prevCollections);
    console.error('[inbox] deleteCollection failed, rolling back:', e);
    throw e;
  }
}

export async function moveItemToCollection(
  itemId: string,
  collectionId: string | undefined,
) {
  const inbox = requireInbox();

  // Validate target collection exists
  if (collectionId && !get(collections)[collectionId]) {
    console.error(
      '[inbox] moveItemToCollection: target collection does not exist:',
      collectionId,
    );
    return;
  }

  // Snapshot stores for rollback
  const prevItems = get(items);
  const prevCollections = get(collections);

  let item: InboxItem | undefined;
  let oldCollectionId: string | undefined;

  items.update((current) => {
    const next = { ...current };
    for (const key of Object.keys(next)) {
      if (next[key].id === itemId) {
        oldCollectionId = next[key].collectionId;
        // Cast to a record so we can drop `collectionId` when the caller
        // moves the item back to Inbox/unfiled — the InboxItem union types
        // collectionId as required-but-optional and rejects structural
        // delete.
        const updated: Record<string, unknown> = { ...next[key] };
        if (collectionId) {
          updated.collectionId = collectionId;
        } else {
          delete updated.collectionId;
        }
        next[key] = updated as unknown as InboxItem;
        item = updated as unknown as InboxItem;
        break;
      }
    }
    return next;
  });

  if (!item) return;

  const isSameCollection = oldCollectionId === collectionId;

  try {
    await inbox.store(cleanForStorage(item));

    // Update source collection's itemIds
    if (oldCollectionId && !isSameCollection) {
      // Capture narrowed value so the closure below doesn't lose the type
      // narrowing (TS doesn't propagate narrowed values through closures).
      const colId = oldCollectionId;
      collections.update((current) => {
        const col = current[colId];
        if (col) {
          return {
            ...current,
            [colId]: {
              ...col,
              itemIds: col.itemIds.filter((id) => id !== itemId),
            },
          };
        }
        return current;
      });
      const sourceCol = get(collections)[oldCollectionId];
      if (sourceCol) {
        await inbox.storeCollection(cleanForStorage(sourceCol));
      }
    }

    // Update target collection's itemIds
    if (collectionId) {
      collections.update((current) => {
        const col = current[collectionId];
        if (col && !col.itemIds.includes(itemId)) {
          return {
            ...current,
            [collectionId]: { ...col, itemIds: [...col.itemIds, itemId] },
          };
        }
        return current;
      });
      const targetCol = get(collections)[collectionId];
      if (targetCol) {
        await inbox.storeCollection(cleanForStorage(targetCol));
      }
    }
  } catch (e) {
    items.set(prevItems);
    collections.set(prevCollections);
    console.error('[inbox] moveItemToCollection failed, rolling back:', e);
    throw e;
  }
}

export async function removeItemFromCollection(itemId: string) {
  return moveItemToCollection(itemId, undefined);
}

export async function reorderCollectionItems(
  collectionId: string,
  newItemIds: string[],
) {
  const inbox = requireInbox();
  const prevCollections = get(collections);
  collections.update((current) => {
    const col = current[collectionId];
    if (col) {
      return { ...current, [collectionId]: { ...col, itemIds: newItemIds } };
    }
    return current;
  });
  try {
    const col = get(collections)[collectionId];
    if (col) {
      await inbox.storeCollection(cleanForStorage(col));
    }
  } catch (e) {
    collections.set(prevCollections);
    console.error('[inbox] reorderCollectionItems failed, rolling back:', e);
    throw e;
  }
}

/**
 * Expand/collapse helpers for the per-collection expansion state stored in
 * `appConfig.expandedCollections`. Callers pass the set of collection ids the
 * toggle should apply to (typically what's currently visible on the page).
 */
export async function setExpandedCollections(ids: string[]) {
  await updateConfig({ expandedCollections: ids });
}

// ---- Group operations ----

const allSortedGroups = orderedDerived<CollectionGroup>(groups, 'groupsOrder');

export const sortedGroups = derived(allSortedGroups, ($groups) =>
  $groups.filter((group) => !group.archived),
);

export const archivedGroups = derived(allSortedGroups, ($groups) =>
  $groups.filter((group) => group.archived),
);

export const archivedCollections = derived(
  [collections, groups],
  ([$collections, $groups]) =>
    Object.values($collections)
      .filter(
        (collection) =>
          collection.archived && !$groups[collection.groupId ?? '']?.archived,
      )
      .sort(
        (a, b) =>
          new Date(b.archivedAt ?? b.createdAt).getTime() -
          new Date(a.archivedAt ?? a.createdAt).getTime(),
      ),
);

export const groupCollections = derived(
  [collections, groups, appConfig],
  ([$collections, $groups]) => {
    const result: Record<string, Collection[]> = {};
    for (const [gid, group] of Object.entries($groups)) {
      const orderedIds = group.collectionIds.filter((cid) => {
        const col = $collections[cid];
        return col !== undefined && col.groupId === gid && !col.archived;
      });
      const orderedSet = new Set(orderedIds);
      // Start with ordered collections whose groupId matches
      const cols: Collection[] = orderedIds.map((cid) => $collections[cid]);
      // Append any collections whose groupId points here but missing from collectionIds
      for (const col of Object.values($collections)) {
        if (col.groupId === gid && !col.archived && !orderedSet.has(col.id)) {
          cols.push(col);
        }
      }
      result[gid] = cols;
    }
    return result;
  },
);

export async function storeGroup(group: CollectionGroup) {
  const inbox = requireInbox();
  const clean = cleanForStorage(group);
  const isNew = !get(groups)[clean.id];
  await inbox.storeGroup(clean);
  groups.update((current) => ({ ...current, [clean.id]: clean }));

  // New groups should appear active in the filter row so the user can see
  // them immediately. Only touch filters when they're explicitly set — an
  // undefined filter list means "all active" and already includes new groups.
  if (isNew) {
    const existing = get(appConfig).activeGroupFilters;
    if (existing !== undefined && !existing.includes(clean.id)) {
      await updateConfig({ activeGroupFilters: [...existing, clean.id] });
    }
  }
}

export async function setGroupArchived(id: string, archived: boolean) {
  const group = get(groups)[id];
  if (!group) return;
  await storeGroup({
    ...group,
    archived: archived || undefined,
    archivedAt: archived ? new Date().toISOString() : undefined,
  });
}

export async function deleteGroup(id: string): Promise<boolean> {
  const inbox = requireInbox();
  const currentGroups = get(groups);
  const group = currentGroups[id];

  if (!group) return false;

  // Refuse to delete a group that still has collections (check groupId, not stale collectionIds)
  const allCollections = get(collections);
  const hasCollections = Object.values(allCollections).some(
    (col) => col.groupId === id,
  );
  if (hasCollections) {
    console.warn(
      '[inbox] cannot delete group with collections — remove them first',
    );
    return false;
  }

  const prevGroups = get(groups);
  try {
    await inbox.removeGroup(id);
    groups.update((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    await removeFromOrderConfig(id, 'groupsOrder');
    // Drop the id from the filter allow-list too. Left behind it becomes a
    // stale id, and a list of nothing but stale ids is the state that makes
    // `activeGroupIds` report "all active" while the stored array says
    // otherwise — see the note on `toggleGroupFilter`. When pruning would empty
    // the list, reset to undefined ("all active") rather than [] ("show
    // nothing"): deleting a group is not a request to hide the survivors.
    const filters = get(appConfig).activeGroupFilters;
    if (filters?.includes(id)) {
      const next = filters.filter((f) => f !== id);
      await updateConfig({
        activeGroupFilters: next.length > 0 ? next : undefined,
      });
    }
    return true;
  } catch (e) {
    groups.set(prevGroups);
    console.error('[inbox] deleteGroup failed, rolling back:', e);
    throw e;
  }
}

export async function moveCollectionToGroup(
  collectionId: string,
  groupId: string,
) {
  const inbox = requireInbox();
  if (!groupId || !get(groups)[groupId]) {
    throw new Error(`Cannot move collection to missing group: ${groupId}`);
  }

  // Snapshot stores for rollback
  const prevCollections = get(collections);
  const prevGroups = get(groups);

  let col: Collection | undefined;
  let oldGroupId: string | undefined;

  collections.update((current) => {
    const next = { ...current };
    if (next[collectionId]) {
      oldGroupId = next[collectionId].groupId;
      const updated = { ...next[collectionId] };
      updated.groupId = groupId;
      next[collectionId] = updated as Collection;
      col = updated as Collection;
    }
    return next;
  });

  if (!col) return;

  try {
    await inbox.storeCollection(cleanForStorage(col));

    // Remove from old group
    if (oldGroupId) {
      // Capture narrowed value so the closure below keeps it non-undefined.
      const grpId = oldGroupId;
      groups.update((current) => {
        const grp = current[grpId];
        if (grp) {
          return {
            ...current,
            [grpId]: {
              ...grp,
              collectionIds: grp.collectionIds.filter(
                (id) => id !== collectionId,
              ),
            },
          };
        }
        return current;
      });
      const oldGrp = get(groups)[oldGroupId];
      if (oldGrp) {
        await inbox.storeGroup(cleanForStorage(oldGrp));
      }
    }

    // Add to new group
    groups.update((current) => {
      const grp = current[groupId];
      if (grp && !grp.collectionIds.includes(collectionId)) {
        return {
          ...current,
          [groupId]: {
            ...grp,
            collectionIds: [...grp.collectionIds, collectionId],
          },
        };
      }
      return current;
    });
    const newGrp = get(groups)[groupId];
    if (newGrp) {
      await inbox.storeGroup(cleanForStorage(newGrp));
    }
  } catch (e) {
    collections.set(prevCollections);
    groups.set(prevGroups);
    console.error('[inbox] moveCollectionToGroup failed, rolling back:', e);
    throw e;
  }
}

/**
 * Create a collection in an explicit real group.
 */
export async function createCollection(col: Collection): Promise<Collection> {
  if (!col.groupId || !get(groups)[col.groupId]) {
    throw new Error('Cannot create collection without a real group');
  }
  await storeCollection(col);
  await moveCollectionToGroup(col.id, col.groupId);
  return col;
}

export async function reorderGroupCollections(
  groupId: string,
  newCollectionIds: string[],
) {
  const inbox = requireInbox();
  const prevGroups = get(groups);
  groups.update((current) => {
    const grp = current[groupId];
    if (grp) {
      return {
        ...current,
        [groupId]: { ...grp, collectionIds: newCollectionIds },
      };
    }
    return current;
  });
  try {
    const grp = get(groups)[groupId];
    if (grp) {
      await inbox.storeGroup(cleanForStorage(grp));
    }
  } catch (e) {
    groups.set(prevGroups);
    console.error('[inbox] reorderGroupCollections failed, rolling back:', e);
    throw e;
  }
}

export async function reorderGroups(newOrder: string[]) {
  await updateConfig({ groupsOrder: newOrder });
}

/**
 * Persist a new order for the unfiled-todo slice of `todosGlobalOrder`.
 *
 * This keeps a single source of truth — `todosGlobalOrder` — and splices the
 * new unfiled order back into their existing slots. Filed todos' positions in
 * the global order are preserved exactly; only
 * the ids that match the new set are replaced, in the order given.
 *
 * The caller passes the full new order of the unfiled subset (not a
 * delta). Ids not currently in `todosGlobalOrder` are appended at the end.
 */
export async function reorderUnfiledTodos(newUnfiledOrder: string[]) {
  const current = get(appConfig).todosGlobalOrder ?? [];
  const allItems = get(items);
  const isUnfiled = (id: string) => {
    const item = allItems[id];
    return (
      !!item && (item.isTodo || item.type === 'todo') && !item.collectionId
    );
  };
  const newSet = new Set(newUnfiledOrder);
  const queue = [...newUnfiledOrder];
  const result: string[] = [];
  for (const id of current) {
    if (isUnfiled(id) || newSet.has(id)) {
      // Pop the next id from `queue` that's actually in the new set — skip any
      // queue entries that dropped out (shouldn't happen in practice, but
      // keeps the splice resilient to stale callers).
      while (queue.length && !newSet.has(queue[0])) queue.shift();
      const next = queue.shift();
      if (next !== undefined) result.push(next);
    } else {
      result.push(id);
    }
  }
  // Append any ids the caller included that weren't already in the global
  // order (e.g. freshly-created todos whose id hasn't been persisted yet).
  while (queue.length) {
    const id = queue.shift();
    if (id === undefined) break;
    if (newSet.has(id) && !result.includes(id)) result.push(id);
  }
  await updateConfig({ todosGlobalOrder: result });
}

// ---- Group filter (toggle row) ----

/**
 * Set of group IDs currently active (visible) in the filter row.
 * When `activeGroupFilters` is undefined in config, all groups default to active.
 *
 * Stale-filter recovery: if `activeGroupFilters` is non-empty but every id in
 * it is stale (no matching real group), we fall back to "all active" instead
 * of returning an empty set. This is the offline-create-then-login recovery
 * path. Concrete sequence:
 *   1. The user has stale ids in `activeGroupFilters` from a previous session
 *      (e.g. a group they deleted long ago, whose id `setActiveGroupFilters`
 *      intentionally retains because the URL→config sync runs before groups
 *      load — see that function's note).
 *   2. While offline they create a new group `Zg`. `storeGroup` only appends
 *      to `activeGroupFilters` when it's already defined; if it was undefined
 *      ("default-all") locally, no append happens — so `Zg.id` may not be in
 *      filters.
 *   3. They log in. Sync pulls down the server's older `config/app` document
 *      (with just the stale ids, no `Zg`), which replaces the local copy.
 *   4. Without this fallback, `activeGroupIds` returns `∅`, and
 *      `visibleGroupedCollections` hides every group — the new `Zg` "remains"
 *      as a pill (pills render from `sortedGroups` directly) but nothing
 *      shows up on the page, making the offline-created collection appear
 *      "gone" even though it's intact in storage.
 *
 * An explicit empty array (`activeGroupFilters: []`, set by toggling every
 * pill off) keeps its meaning: "show nothing" — `length === 0` so the
 * fallback doesn't trigger.
 */
export const activeGroupIds = derived(
  [sortedGroups, appConfig],
  ([$sortedGroups, $config]) => {
    const all = new Set($sortedGroups.map((g) => g.id));
    if ($config.activeGroupFilters === undefined) return all;
    const filtered = new Set<string>();
    for (const id of $config.activeGroupFilters) {
      if (all.has(id)) filtered.add(id);
    }
    if (filtered.size === 0 && $config.activeGroupFilters.length > 0) {
      return all;
    }
    return filtered;
  },
);

/**
 * Collection IDs explicitly switched OFF in the sidebar layout (a deny-list).
 * A collection is hidden when its id is here, independent of its group's
 * active state. Stale ids (deleted collections) are harmless — views
 * intersect this against real collections at read time.
 */
export const inactiveCollectionIds = derived(
  appConfig,
  ($config) => new Set($config.inactiveCollectionFilters ?? []),
);

/**
 * Group + collection bundle, in the configured group order, filtered by
 * activeGroupIds. Within each group, collections preserve the configured
 * order from groupCollections, minus any individually switched off via the
 * sidebar (inactiveCollectionIds).
 *
 */
export interface VisibleGroupSection {
  group: CollectionGroup;
  collections: Collection[];
}

export const visibleGroupedCollections = derived(
  [sortedGroups, groupCollections, activeGroupIds, inactiveCollectionIds],
  ([
    $sortedGroups,
    $groupCollections,
    $activeGroupIds,
    $inactiveCollectionIds,
  ]): VisibleGroupSection[] => {
    const sections: VisibleGroupSection[] = [];
    for (const g of $sortedGroups) {
      if (!$activeGroupIds.has(g.id)) continue;
      const collections = ($groupCollections[g.id] ?? []).filter(
        (c) => !$inactiveCollectionIds.has(c.id),
      );
      sections.push({ group: g, collections });
    }
    return sections;
  },
);

/**
 * Collections whose `groupId` is unset or refers to a group that no longer
 * exists. Surfaced read-only on the Collections page as an advisory section
 * so users can edit each one back into a real group (or delete it). We do
 * NOT auto-rewrite these on load — see the v2.0.4 regression note in the
 * connect handler — and we do NOT create a synthetic group/collection for
 * them. The list is empty in the normal case; the UI only renders a section
 * when this is non-empty. Sorted by createdAt for a stable order.
 */
export const orphanCollections = derived(
  [collections, groups],
  ([$collections, $groups]): Collection[] => {
    return Object.values($collections)
      .filter((col) => !col.archived && (!col.groupId || !$groups[col.groupId]))
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
  },
);

/**
 * Toggle a group's filter on/off. Persists to config.
 * If activeGroupFilters was undefined (default-all), this materializes the
 * current set first, then flips the requested id.
 *
 * The "current" set is read from `activeGroupIds` — the same effective set the
 * pills and sidebar render from — not from the raw `activeGroupFilters` array.
 * Those two disagree whenever the stored array is non-empty but every id in it
 * is stale: `activeGroupIds` then falls back to all-active (see its note), so
 * every pill looks selected, while the raw array contains none of the real
 * ids. Reading the raw array there would score the click as an *activation*,
 * appending the id to a list of dead ones and leaving exactly one group
 * visible — "click any pill and it solos that group, with no way to switch one
 * off". Deriving from the effective set also prunes the stale ids on write, so
 * a single toggle heals the config.
 *
 * When *activating* a group, any per-collection hides (the deny-list) for that
 * group's collections are cleared, so "show this group" always reveals all of
 * its collections. This keeps the two sidebar gestures coherent: the group
 * toggle means "show everything in this group", while clicking an individual
 * collection (`enableCollectionFilter`) means "show just this one". Without
 * this, siblings hidden by an earlier exclusive collection-enable would stay
 * hidden even after re-enabling the group.
 */
export async function toggleGroupFilter(groupId: string): Promise<void> {
  const config = get(appConfig);
  const allGroupIds = get(sortedGroups).map((g) => g.id);
  const effective = get(activeGroupIds);
  const current = allGroupIds.filter((id) => effective.has(id));
  const activating = !current.includes(groupId);
  const next = activating
    ? [...current, groupId]
    : current.filter((id) => id !== groupId);

  const patch: Partial<AppConfig> = { activeGroupFilters: next };

  if (activating) {
    const deny = config.inactiveCollectionFilters;
    if (deny && deny.length > 0) {
      const groupColIds = new Set(
        (get(groupCollections)[groupId] ?? []).map((c) => c.id),
      );
      const nextDeny = deny.filter((id) => !groupColIds.has(id));
      if (nextDeny.length !== deny.length) {
        patch.inactiveCollectionFilters = nextDeny;
      }
    }
  }

  await updateConfig(patch);
}

/**
 * Show only `groupId`, hiding every other group — the ⌘/Ctrl-click gesture on a
 * group pill or sidebar row. Persists to config.
 *
 * The gesture is its own undo: soloing the group that is *already* alone
 * restores all groups (filters back to undefined, "default-all"). Without that,
 * getting back would mean clicking every other group on by hand — the exact
 * dead end plain toggling used to have.
 *
 * Like `toggleGroupFilter`, soloing clears any per-collection hides belonging to
 * the soloed group, so "show only this group" really does show all of it.
 * Restoring all groups leaves the deny-list alone: it undoes the solo, and is
 * not a "reveal everything" hammer.
 */
export async function soloGroupFilter(groupId: string): Promise<void> {
  const config = get(appConfig);
  const effective = get(activeGroupIds);

  if (effective.size === 1 && effective.has(groupId)) {
    await updateConfig({ activeGroupFilters: undefined });
    return;
  }

  const patch: Partial<AppConfig> = { activeGroupFilters: [groupId] };
  const deny = config.inactiveCollectionFilters;
  if (deny && deny.length > 0) {
    const groupColIds = new Set(
      (get(groupCollections)[groupId] ?? []).map((c) => c.id),
    );
    const nextDeny = deny.filter((id) => !groupColIds.has(id));
    if (nextDeny.length !== deny.length) {
      patch.inactiveCollectionFilters = nextDeny;
    }
  }

  await updateConfig(patch);
}

/** Set the active group filter list to exactly these IDs. Persists to config.
 *
 * Does not filter against known groups — the URL→config sync runs before
 * `groups` finishes loading on cold refresh, and dropping ids whose group
 * hasn't loaded yet would wipe valid filters and immediately rewrite the URL
 * to `?g=` empty. Stale ids (groups that were deleted) are filtered out at
 * read time by `activeGroupIds`, so persisting them is harmless.
 */
export async function setActiveGroupFilters(ids: string[]): Promise<void> {
  const filtered = Array.from(new Set(ids));
  const current = get(appConfig).activeGroupFilters;
  // Skip if equal to current (avoids URL ↔ config write loops)
  if (
    current &&
    current.length === filtered.length &&
    current.every((v, i) => v === filtered[i])
  ) {
    return;
  }
  await updateConfig({ activeGroupFilters: filtered });
}

/**
 * Toggle a single collection's visibility on/off (sidebar layout). Persists to
 * config as a deny-list entry — see `inactiveCollectionIds`. Independent of the
 * collection's group filter.
 */
export async function toggleCollectionFilter(
  collectionId: string,
): Promise<void> {
  const config = get(appConfig);
  const current = config.inactiveCollectionFilters ?? [];
  const next = current.includes(collectionId)
    ? current.filter((id) => id !== collectionId)
    : [...current, collectionId];
  await updateConfig({ inactiveCollectionFilters: next });
}

/**
 * Enable a single collection directly from the sidebar, making it visible even
 * when its parent group is currently switched off.
 *
 * - If the parent group was already active, this is a plain additive reveal:
 *   the collection is removed from the deny-list; siblings are untouched.
 * - If the parent group was NOT active, this is an *exclusive* enable: the
 *   group is activated and every other collection in it is deny-listed, so
 *   only the clicked collection shows. This spares the user from enabling the
 *   whole group and then hiding each sibling by hand — the point of the
 *   gesture. `toggleGroupFilter` clears these hides again on the next group
 *   activation, so "show the whole group" remains one click away.
 *
 * A collection with no `groupId` (orphan) is simply un-hidden.
 */
export async function enableCollectionFilter(
  collectionId: string,
): Promise<void> {
  const config = get(appConfig);
  const groupId = get(collections)[collectionId]?.groupId;
  const allGroupIds = get(sortedGroups).map((g) => g.id);
  const currentGroups = config.activeGroupFilters ?? allGroupIds;
  const groupActive = groupId ? currentGroups.includes(groupId) : true;

  const patch: Partial<AppConfig> = {};
  const deny = new Set(config.inactiveCollectionFilters ?? []);

  if (groupId && !groupActive) {
    // Activate the group and show only this collection.
    patch.activeGroupFilters = [...currentGroups, groupId];
    for (const col of get(groupCollections)[groupId] ?? []) {
      if (col.id !== collectionId) deny.add(col.id);
    }
  }
  // Always reveal the clicked collection (covers the group-already-active and
  // orphan cases, and guards against it being missing from the group list).
  deny.delete(collectionId);

  patch.inactiveCollectionFilters = Array.from(deny);
  await updateConfig(patch);
}

/**
 * Show only one collection — the ⌘/Ctrl-click gesture on a sidebar
 * collection row. The collection's parent becomes the only active group and
 * every sibling collection is hidden.
 *
 * Repeating the gesture when the collection is already alone restores all
 * groups and all collections in its group. Deny-list entries belonging to
 * other groups are preserved.
 */
export async function soloCollectionFilter(
  collectionId: string,
): Promise<void> {
  const collection = get(collections)[collectionId];
  const groupId = collection?.groupId;
  if (!groupId) return;

  const siblings = (get(groupCollections)[groupId] ?? []).filter(
    (col) => col.id !== collectionId,
  );
  const effectiveGroups = get(activeGroupIds);
  const inactive = new Set(get(appConfig).inactiveCollectionFilters ?? []);
  const alreadySoloed =
    effectiveGroups.size === 1 &&
    effectiveGroups.has(groupId) &&
    !inactive.has(collectionId) &&
    siblings.every((col) => inactive.has(col.id));

  if (alreadySoloed) {
    for (const col of siblings) inactive.delete(col.id);
    await updateConfig({
      activeGroupFilters: undefined,
      inactiveCollectionFilters: Array.from(inactive),
    });
    return;
  }

  for (const col of siblings) inactive.add(col.id);
  inactive.delete(collectionId);
  await updateConfig({
    activeGroupFilters: [groupId],
    inactiveCollectionFilters: Array.from(inactive),
  });
}

// ---- Flat Todos page: all todos across all collections ----

/**
 * Every item that represents a todo. Todos without `collectionId` are unfiled
 * and remain valid todos; they are not routed through a collection/group.
 */
export const allTodos = derived(items, ($items) => {
  return Object.values($items).filter((i) => i.isTodo || i.type === 'todo');
});

/** Convenience: open todos across all collections, for badges/counts.
 *  Excludes todos moved to a calendar — the calendar owns those. */
export const openTodos = derived(allTodos, ($allTodos) =>
  $allTodos.filter((t) => !t.completed && !t.archived),
);

/**
 * The group-filter rule for the flat Todos page: unfiled todos are always
 * visible; filed todos require their collection's group to be active and
 * the collection not individually filtered out.
 */
function todoPassesGroupFilter(
  todo: InboxItem,
  $collections: Record<string, Collection>,
  $activeGroupIds: Set<string>,
  $inactiveCollectionIds: Set<string>,
): boolean {
  if (!todo.collectionId) return true;
  const col = $collections[todo.collectionId];
  if (!col) return true;
  if (col.archived) return false;
  if (!col.groupId) return false;
  if (!$activeGroupIds.has(col.groupId)) return false;
  return !$inactiveCollectionIds.has(col.id);
}

/**
 * Todos visible on the flat Todos page. Unfiled todos are always visible;
 * filed todos honour the group-filter row. Sorted by `todosGlobalOrder`; ids
 * missing from that order fall back to newest-first on `createdAt`. Completed
 * and open todos are mixed — the page splits them at render time.
 */
export const visibleTodos = derived(
  [
    allTodos,
    collections,
    activeGroupIds,
    inactiveCollectionIds,
    appConfig,
    todayStart,
  ],
  ([
    $allTodos,
    $collections,
    $activeGroupIds,
    $inactiveCollectionIds,
    $config,
    $todayStart,
  ]) => {
    const filtered = $allTodos.filter(
      (todo) =>
        !todo.archived &&
        todoPassesGroupFilter(
          todo,
          $collections,
          $activeGroupIds,
          $inactiveCollectionIds,
        ),
    );

    const sorted = sortWithConfiguredOrder(
      filtered,
      $config.todosGlobalOrder,
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    // Deadlines remain the strongest signal. Pinned items lead the manually
    // ordered band immediately below them.
    return pinDueTodos(pinItemsFirst(sorted), $todayStart);
  },
);

/**
 * Due/overdue todos float in a band above the manual order, earliest due
 * first; everything else keeps its configured position. Completed todos are
 * never band members (isDueTodayOrOverdue excludes them), so the page's
 * render-time open/completed split is unaffected.
 */
function pinDueTodos(sorted: InboxItem[], todayStartMs: number): InboxItem[] {
  const due = sorted
    .filter((t) => isDueTodayOrOverdue(t, todayStartMs))
    .sort(compareByDueTime);
  if (due.length === 0) return sorted;
  const rest = sorted.filter((t) => !isDueTodayOrOverdue(t, todayStartMs));
  return [...due, ...rest];
}

/**
 * Todos moved to a calendar, for the Todos page's collapsed "on calendar"
 * section. Honours the same group filter as `visibleTodos`; newest move
 * first. Removing the calendar entry returns a todo to the open list.
 */
export const visibleOnCalendarTodos = derived(
  [allTodos, collections, activeGroupIds, inactiveCollectionIds],
  ([$allTodos, $collections, $activeGroupIds, $inactiveCollectionIds]) =>
    $allTodos
      .filter(
        (todo) =>
          !!todo.archived &&
          todoPassesGroupFilter(
            todo,
            $collections,
            $activeGroupIds,
            $inactiveCollectionIds,
          ),
      )
      .sort(
        (a, b) =>
          new Date(b.archivedAt ?? b.createdAt).getTime() -
          new Date(a.archivedAt ?? a.createdAt).getTime(),
      ),
);

/**
 * Open todos within the current group/collection focus — exactly the set the
 * Todos page shows as "open". This is what the nav badge counts, so the badge
 * matches the list the user actually sees. Filtering to a group shrinks both
 * together, instead of the badge stubbornly reporting a global total.
 */
export const visibleOpenTodos = derived(visibleTodos, ($visibleTodos) =>
  $visibleTodos.filter((t) => !t.completed),
);

/**
 * Persist a new order for todos on the flat Todos page. Only stores the ids
 * the caller passed — any todos that appear later fall back to createdAt
 * ordering via `sortWithConfiguredOrder`.
 */
export async function reorderTodosGlobal(newOrder: string[]) {
  await updateConfig({ todosGlobalOrder: newOrder });
}
