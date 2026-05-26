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
import rs, { fetchFileBlobUrl } from './rs';

function getInbox() {
  return rs.inbox;
}

/** Blob URLs for files that were just uploaded (available before remote sync completes) */
export const blobUrls = writable<Record<string, string>>({});

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

function requiresContentMigration(doc: object): boolean {
  const migrated = migrator.migrateDocument('items', doc as InboxItem);
  if (migrated === doc) return false;
  return (
    JSON.stringify(stripMigrationVersion(migrated)) !==
    JSON.stringify(stripMigrationVersion(doc))
  );
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
  const inbox = getInbox();
  if (!inbox) return false;
  try {
    const all = await fetchAll.call(inbox);
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
  return candidate as InboxItem;
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
  inboxRef.onChange((rawEvent: unknown) => {
    const event = rawEvent as ChangeEvent;
    if (!event || event.origin === 'window') return;
    const path: string = event.relativePath || '';
    const value = event.newValue;

    if (path.startsWith('items/')) {
      const key = path.slice('items/'.length);
      if (value && typeof value === 'object' && value.id) {
        if (key !== (value as { id: string }).id) return;
        rawItems.update((current) => ({ ...current, [key]: value as object }));
        items.update((current) => ({
          ...current,
          [key]: normalizeLoadedItem(value as object),
        }));
      } else if (!value) {
        rawItems.update((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        items.update((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    } else if (path.startsWith('collections/')) {
      const key = path.slice('collections/'.length);
      if (value && typeof value === 'object' && value.id) {
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
      if (value && typeof value === 'object' && value.id) {
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

  return entities.sort((a, b) => {
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
  return Object.values($items)
    .filter((i) => !i.isTodo && i.type !== 'todo' && !i.collectionId)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
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
export const todoItems = derived([items, appConfig], ([$items, $config]) => {
  const all = Object.values($items).filter(
    (i) => (i.isTodo || i.type === 'todo') && !i.collectionId,
  );
  const open = all.filter((i) => !i.completed);
  const completed = all.filter((i) => i.completed);

  sortWithConfiguredOrder(
    open,
    $config.todosGlobalOrder,
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // Completed sorted by completedAt desc
  completed.sort(
    (a, b) =>
      new Date(b.completedAt ?? b.createdAt).getTime() -
      new Date(a.completedAt ?? a.createdAt).getTime(),
  );

  return [...open, ...completed];
});

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
/** Paths for which we have explicitly revoked (via deleteItem) so in-flight loads don't re-insert. */
const revokedBlobPaths = new Set<string>();

/**
 * Fetch a file from RS and create a blob URL, stored in blobUrls for reactive display.
 * No-ops if already loaded or in progress. Components should call this on mount.
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
  if (!get(connected)) return;
  const gen = blobLoadGeneration;
  pendingBlobLoads.set(filePath, gen);
  fetchFileBlobUrl(filePath, mimeType)
    .then((url) => {
      if (!url) return;
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
    })
    .finally(() => {
      if (pendingBlobLoads.get(filePath) === gen) {
        pendingBlobLoads.delete(filePath);
      }
    });
}

// ---- Item operations ----

export async function storeItem(item: InboxItem, fileData?: ArrayBuffer) {
  const inbox = getInbox();
  const cleanItem = cleanForStorage(item);
  await inbox.store(cleanItem, fileData);
  if (fileData && 'filePath' in item && item.filePath && 'mimeType' in item) {
    const blob = new Blob([fileData], {
      type: (item as { mimeType?: string }).mimeType,
    });
    const url = URL.createObjectURL(blob);
    blobUrls.update((current) => ({
      ...current,
      [item.filePath as string]: url,
    }));
  }
  rawItems.update((current) => ({
    ...current,
    [cleanItem.id]: cleanItem as object,
  }));
  items.update((current) => ({ ...current, [cleanItem.id]: cleanItem }));
}

export async function deleteItem(id: string, item?: InboxItem) {
  const inbox = getInbox();
  await inbox.remove(id, item);

  // Revoke and remove any associated blob URL to prevent memory leaks.
  // All current callers pass the full item; we also do a defensive lookup.
  const filePath =
    (item && 'filePath' in item && (item as { filePath?: string }).filePath) ||
    (get(items)[id] &&
      'filePath' in get(items)[id] &&
      (get(items)[id] as { filePath?: string }).filePath);

  if (typeof filePath === 'string' && filePath) {
    const existing = get(blobUrls)[filePath];
    if (existing) {
      try {
        URL.revokeObjectURL(existing);
      } catch {
        // ignore
      }
      blobUrls.update((current) => {
        const next = { ...current };
        delete next[filePath];
        return next;
      });
    }
    // Also drop any in-flight load for this specific file (no global gen bump needed).
    pendingBlobLoads.delete(filePath);
    // Mark as revoked so any concurrent in-flight load for this exact path is ignored on resolution.
    revokedBlobPaths.add(filePath);
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
  const inbox = getInbox();
  const clean = cleanForStorage(collection);
  await inbox.storeCollection(clean);
  collections.update((current) => ({ ...current, [clean.id]: clean }));
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
  const inbox = getInbox();
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
  const inbox = getInbox();

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
  const inbox = getInbox();
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

export const sortedGroups = orderedDerived<CollectionGroup>(
  groups,
  'groupsOrder',
);

export const groupCollections = derived(
  [collections, groups, appConfig],
  ([$collections, $groups]) => {
    const result: Record<string, Collection[]> = {};
    for (const [gid, group] of Object.entries($groups)) {
      const orderedIds = group.collectionIds.filter((cid) => {
        const col = $collections[cid];
        return col !== undefined && col.groupId === gid;
      });
      const orderedSet = new Set(orderedIds);
      // Start with ordered collections whose groupId matches
      const cols: Collection[] = orderedIds.map((cid) => $collections[cid]);
      // Append any collections whose groupId points here but missing from collectionIds
      for (const col of Object.values($collections)) {
        if (col.groupId === gid && !orderedSet.has(col.id)) {
          cols.push(col);
        }
      }
      result[gid] = cols;
    }
    return result;
  },
);

export async function storeGroup(group: CollectionGroup) {
  const inbox = getInbox();
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

export async function deleteGroup(id: string): Promise<boolean> {
  const inbox = getInbox();
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
  const inbox = getInbox();
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
  const inbox = getInbox();
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
 * Group + collection bundle, in the configured group order, filtered by
 * activeGroupIds. Within each group, collections preserve the configured
 * order from groupCollections.
 *
 */
export interface VisibleGroupSection {
  group: CollectionGroup;
  collections: Collection[];
}

export const visibleGroupedCollections = derived(
  [sortedGroups, groupCollections, activeGroupIds],
  ([
    $sortedGroups,
    $groupCollections,
    $activeGroupIds,
  ]): VisibleGroupSection[] => {
    const sections: VisibleGroupSection[] = [];
    for (const g of $sortedGroups) {
      if (!$activeGroupIds.has(g.id)) continue;
      sections.push({ group: g, collections: $groupCollections[g.id] ?? [] });
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
      .filter((col) => !col.groupId || !$groups[col.groupId])
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
 */
export async function toggleGroupFilter(groupId: string): Promise<void> {
  const config = get(appConfig);
  const allGroupIds = get(sortedGroups).map((g) => g.id);
  const current = config.activeGroupFilters ?? allGroupIds;
  const next = current.includes(groupId)
    ? current.filter((id) => id !== groupId)
    : [...current, groupId];
  await updateConfig({ activeGroupFilters: next });
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

// ---- Flat Todos page: all todos across all collections ----

/**
 * Every item that represents a todo. Todos without `collectionId` are unfiled
 * and remain valid todos; they are not routed through a collection/group.
 */
export const allTodos = derived(items, ($items) => {
  return Object.values($items).filter((i) => i.isTodo || i.type === 'todo');
});

/** Convenience: open todos across all collections, for badges/counts. */
export const openTodos = derived(allTodos, ($allTodos) =>
  $allTodos.filter((t) => !t.completed),
);

/**
 * Todos visible on the flat Todos page. Unfiled todos are always visible;
 * filed todos honour the group-filter row. Sorted by `todosGlobalOrder`; ids
 * missing from that order fall back to newest-first on `createdAt`. Completed
 * and open todos are mixed — the page splits them at render time.
 */
export const visibleTodos = derived(
  [allTodos, collections, activeGroupIds, appConfig],
  ([$allTodos, $collections, $activeGroupIds, $config]) => {
    const filtered = $allTodos.filter((todo) => {
      if (!todo.collectionId) return true;
      const col = $collections[todo.collectionId];
      if (!col) return true;
      if (!col.groupId) return false;
      return $activeGroupIds.has(col.groupId);
    });

    return sortWithConfiguredOrder(
      filtered,
      $config.todosGlobalOrder,
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  },
);

/**
 * Persist a new order for todos on the flat Todos page. Only stores the ids
 * the caller passed — any todos that appear later fall back to createdAt
 * ordering via `sortWithConfiguredOrder`.
 */
export async function reorderTodosGlobal(newOrder: string[]) {
  await updateConfig({ todosGlobalOrder: newOrder });
}
