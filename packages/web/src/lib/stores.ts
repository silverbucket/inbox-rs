import { writable, derived, get } from 'svelte/store';
import type { Writable, Readable } from 'svelte/store';
import type { InboxItem, AppConfig, UserSettings, Collection, CollectionGroup } from '@inbox-rs/rs-module';
import { migrator, wrapCodeBlock } from '@inbox-rs/rs-module';
import { cleanForStorage } from './clean-for-storage';
import rs, { fetchFileBlobUrl } from './rs';

function getInbox() {
  return (rs as any).inbox;
}

/** Blob URLs for files that were just uploaded (available before remote sync completes) */
export const blobUrls = writable<Record<string, string>>({});

export const connected = writable(false);
export const syncing = writable(false);

function readStoredUserAddress(): string {
  try {
    // remoteStorage.js persists the user address in this key
    const settings = JSON.parse(localStorage.getItem('remotestorage:wireclient') ?? '{}');
    return settings?.userAddress ?? localStorage.getItem('inbox-rs:userAddress') ?? '';
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
  return JSON.stringify(stripMigrationVersion(migrated)) !== JSON.stringify(stripMigrationVersion(doc));
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
  ([$rawPendingMigrationCount, $migrationAlertReady]) => (
    $migrationAlertReady ? $rawPendingMigrationCount : 0
  ),
);

// ---- Generic helpers ----

async function loadEntities<T extends { id: string }>(
  fetchAll: () => Promise<Record<string, unknown>>,
  store: Writable<Record<string, T>>,
  arrayField?: keyof T,
): Promise<void> {
  const inbox = getInbox();
  if (!inbox) return;
  try {
    const all = await fetchAll.call(inbox);
    const valid: Record<string, T> = {};
    for (const [key, raw] of Object.entries(all)) {
      if (raw && typeof raw === 'object' && 'id' in raw && (raw as T).id) {
        const entity = raw as T;
        if (key !== entity.id) continue;
        if (arrayField) {
          valid[key] = { ...entity, [arrayField]: Array.isArray(entity[arrayField]) ? entity[arrayField] : [] };
        } else {
          valid[key] = entity;
        }
      }
    }
    store.set(valid);
  } catch {
    // RS sync/fetch error — keep existing data
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
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  });
}

async function removeFromOrderConfig(id: string, key: 'collectionsOrder' | 'groupsOrder' | 'todosOrder') {
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
  if (!inbox) return;
  try {
    const all = await inbox.getAll();
    const valid: Record<string, InboxItem> = {};
    const rawValid: Record<string, object> = {};
    for (const [key, item] of Object.entries(all)) {
      if (item && typeof item === 'object' && 'id' in item && typeof (item as { id?: unknown }).id === 'string') {
        // Only trust canonically-addressed item records. This avoids rendering
        // duplicate/stale documents that may still exist under malformed keys.
        if (key !== (item as { id: string }).id) continue;
        rawValid[key] = item;
        valid[key] = normalizeLoadedItem(item);
      }
    }
    rawItems.set(rawValid);
    items.set(valid);
  } catch {
    // RS sync/fetch error — keep existing items
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
  } catch {
    // ignore
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
  } catch {
    // ignore
  }
}

async function loadCollections() {
  const inbox = getInbox();
  await loadEntities<Collection>(() => inbox.getAllCollections(), collections, 'itemIds');
}

async function loadGroups() {
  const inbox = getInbox();
  await loadEntities<CollectionGroup>(() => inbox.getAllGroups(), groups, 'collectionIds');
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

// Debug: log sync activity
rs.on('sync-req-done', (e: any) => {
  console.log('[inbox] sync-req-done, tasks remaining:', e?.tasksRemaining);
});
rs.on('sync-done', (e: any) => {
  console.log('[inbox] sync-done:', e);
});
rs.on('wire-busy', () => console.log('[inbox] wire-busy'));
rs.on('wire-done', () => console.log('[inbox] wire-done'));

rs.on('connected', async () => {
  connected.set(true);
  resetMigrationAlertReadiness();
  const addr =
    (rs as any).remote?.userAddress ||
    localStorage.getItem('inbox-rs:userAddress') ||
    '';
  userAddress.set(addr);
  await Promise.all([loadItems(), loadConfig(), loadUserSettings(), loadCollections(), loadGroups()]);
  scheduleMigrationAlertFallback();
});

rs.on('disconnected', () => {
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
  if (!inbox) throw new Error('Cannot update user settings: storage not connected');
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
  inboxRef.onChange((event: any) => {
    if (!event || event.origin === 'window') return;
    const path: string = event.relativePath || '';
    const value = event.newValue;

    if (path.startsWith('items/')) {
      const key = path.slice('items/'.length);
      if (value && typeof value === 'object' && value.id) {
        if (key !== (value as { id: string }).id) return;
        rawItems.update(current => ({ ...current, [key]: value as object }));
        items.update(current => ({ ...current, [key]: normalizeLoadedItem(value as object) }));
      } else if (!value) {
        rawItems.update(current => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        items.update(current => {
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
        collections.update(current => ({
          ...current,
          [key]: { ...col, itemIds: Array.isArray(col.itemIds) ? col.itemIds : [] },
        }));
      } else if (!value) {
        collections.update(current => {
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
        groups.update(current => ({
          ...current,
          [key]: { ...grp, collectionIds: Array.isArray(grp.collectionIds) ? grp.collectionIds : [] },
        }));
      } else if (!value) {
        groups.update(current => {
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
  if (document.visibilityState === 'visible' && (rs as any).remote?.connected) {
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

// Bucket semantics:
//   - **Collection**: item has `collectionId` set → lives in that collection.
//   - **Inbox** (references only): non-todo item with no `collectionId` and no
//     `uncategorized` flag. Inbox never holds todos by design — see
//     AddEntryModal: the todo type's collection picker skips the "Inbox"
//     option.
//   - **Uncategorized**: anything with no `collectionId` that's either a todo
//     (implicit — todos can't live in the Inbox, so a todo without a
//     collection is always uncategorized) or a ref with `uncategorized: true`
//     (explicit opt-in from the picker, or orphaned by a collection deletion).
//
// The three surfaces are mutually exclusive for any given item.

/** Inbox reference items: non-todos with no collectionId and no `uncategorized` flag. */
export const sortedItems = derived(items, ($items) => {
  return Object.values($items)
    .filter(i => !i.isTodo && i.type !== 'todo' && !i.collectionId && !i.uncategorized)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
});

/**
 * Uncategorized todos — every todo without a `collectionId` qualifies, since
 * todos never live in the Inbox. Sorted open-first (respecting `todosOrder`)
 * then completed (by `completedAt` desc).
 *
 * Named `todoItems` rather than `uncategorizedTodoItems` for backwards
 * compatibility with callers (CollectionItemPicker, test suite) that used this
 * name when the Inbox vs Uncategorized distinction didn't exist for todos.
 */
export const todoItems = derived([items, appConfig], ([$items, $config]) => {
  const all = Object.values($items)
    .filter(i => (i.isTodo || i.type === 'todo') && !i.collectionId);
  const open = all.filter(i => !i.completed);
  const completed = all.filter(i => i.completed);

  sortWithConfiguredOrder(
    open,
    $config.todosOrder,
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // Completed sorted by completedAt desc
  completed.sort((a, b) => new Date(b.completedAt ?? b.createdAt).getTime() - new Date(a.completedAt ?? a.createdAt).getTime());

  return [...open, ...completed];
});

/** Uncategorized reference items: non-todos with no collectionId that opted into
 *  the Uncategorized bucket via the `uncategorized: true` flag. */
export const uncategorizedReferenceItems = derived(items, ($items) => {
  return Object.values($items)
    .filter(i => !i.isTodo && i.type !== 'todo' && !i.collectionId && i.uncategorized === true)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
});

export const sortedCollections = orderedDerived<Collection>(collections, 'collectionsOrder');

export const collectionItems = derived(
  [items, collections, todoItems, uncategorizedReferenceItems],
  ([$items, $collections, $todoItems, $uncatRefs]) => {
    const result: Record<string, InboxItem[]> = {};
    const itemMap = new Map(Object.values($items).map(i => [i.id, i]));
    for (const [cid, col] of Object.entries($collections)) {
      result[cid] = col.itemIds
        .map(id => itemMap.get(id))
        .filter((i): i is InboxItem => i !== undefined && i.collectionId === cid);
    }
    // Virtual Uncategorized collection — surfaces every uncategorized item
    // under a sentinel id so CollectionView's existing
    // `$collectionItems[collection.id]` lookup Just Works for the virtual bucket.
    //
    // Inbox refs (no `collectionId`, no `uncategorized` flag) deliberately do
    // NOT surface here — they belong to the Inbox view only. Todos, however,
    // all surface here when they have no `collectionId` because todos can't
    // live in the Inbox (AddEntryModal enforces this — see its picker).
    //
    // Order: open todos first (respecting `todosOrder`), then completed todos,
    // then reference items newest-first.
    result[UNCATEGORIZED_COLLECTION_ID] = [...$todoItems, ...$uncatRefs];
    return result;
  }
);

// ---- File blob URL loading ----

const pendingBlobLoads = new Set<string>();

/**
 * Fetch a file from RS and create a blob URL, stored in blobUrls for reactive display.
 * No-ops if already loaded or in progress. Components should call this on mount.
 */
export function loadFileBlobUrl(filePath: string): void {
  if (!filePath) return;
  if (get(blobUrls)[filePath] || pendingBlobLoads.has(filePath)) return;
  if (!get(connected)) return;
  pendingBlobLoads.add(filePath);
  fetchFileBlobUrl(filePath)
    .then((url) => {
      if (url) {
        const old = get(blobUrls)[filePath];
        if (old) URL.revokeObjectURL(old);
        blobUrls.update(current => ({ ...current, [filePath]: url }));
      }
    })
    .finally(() => {
      pendingBlobLoads.delete(filePath);
    });
}

// ---- Item operations ----

export async function storeItem(item: InboxItem, fileData?: ArrayBuffer) {
  const inbox = getInbox();
  const cleanItem = cleanForStorage(item);
  await inbox.store(cleanItem, fileData);
  if (fileData && 'filePath' in item && item.filePath && 'mimeType' in item) {
    const blob = new Blob([fileData], { type: (item as any).mimeType });
    const url = URL.createObjectURL(blob);
    blobUrls.update(current => ({ ...current, [item.filePath as string]: url }));
  }
  rawItems.update(current => ({ ...current, [cleanItem.id]: cleanItem as object }));
  items.update(current => ({ ...current, [cleanItem.id]: cleanItem }));
}

export async function deleteItem(id: string, item?: InboxItem) {
  const inbox = getInbox();
  await inbox.remove(id, item);
  rawItems.update(current => {
    const next = { ...current };
    for (const key of Object.keys(next)) {
      if ((next[key] as { id?: string }).id === id) {
        delete next[key];
        break;
      }
    }
    return next;
  });
  items.update(current => {
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
  collections.update(current => ({ ...current, [clean.id]: clean }));
}

/**
 * Delete a collection. Refuses if the collection still contains items — the
 * caller is expected to either move items out (drag/drop, picker) or delete
 * them first. This mirrors `deleteGroup`'s "must be empty" rule and avoids
 * silently orphaning user-filed items into the Uncategorized bucket on a
 * delete tap. Returns `true` on success, `false` when the delete was refused.
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
  const hasItems = Object.values(allItems).some(i => i.collectionId === id);
  if (hasItems) {
    console.warn('[inbox] cannot delete collection with items — remove them first');
    return false;
  }

  const prevCollections = get(collections);
  try {
    await inbox.removeCollection(id);
    collections.update(current => {
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

export async function moveItemToCollection(itemId: string, collectionId: string | undefined) {
  const inbox = getInbox();

  // Validate target collection exists
  if (collectionId && !get(collections)[collectionId]) {
    console.error('[inbox] moveItemToCollection: target collection does not exist:', collectionId);
    return;
  }

  // Snapshot stores for rollback
  const prevItems = get(items);
  const prevCollections = get(collections);

  let item: InboxItem | undefined;
  let oldCollectionId: string | undefined;

  items.update(current => {
    const next = { ...current };
    for (const key of Object.keys(next)) {
      if (next[key].id === itemId) {
        oldCollectionId = next[key].collectionId;
        const updated = { ...next[key] };
        if (collectionId) {
          updated.collectionId = collectionId;
          // Moving into a real collection wipes the Uncategorized marker —
          // the collection placement wins, and the flag would be meaningless
          // noise if it lingered.
          delete (updated as any).uncategorized;
        } else {
          delete (updated as any).collectionId;
          // Removing a collection placement without another explicit bucket
          // routes the item to the Uncategorized bucket, mirroring what
          // happens when a collection is deleted. Inbox is reserved for items
          // the user has never filed, so we shouldn't silently return
          // previously-filed items there.
          updated.uncategorized = true;
        }
        next[key] = updated as InboxItem;
        item = updated as InboxItem;
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
      collections.update(current => {
        const col = current[oldCollectionId!];
        if (col) {
          return { ...current, [oldCollectionId!]: { ...col, itemIds: col.itemIds.filter(id => id !== itemId) } };
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
      collections.update(current => {
        const col = current[collectionId];
        if (col && !col.itemIds.includes(itemId)) {
          return { ...current, [collectionId]: { ...col, itemIds: [...col.itemIds, itemId] } };
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

export async function reorderCollectionItems(collectionId: string, newItemIds: string[]) {
  const inbox = getInbox();
  const prevCollections = get(collections);
  collections.update(current => {
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

export async function reorderCollections(newOrder: string[]) {
  await updateConfig({ collectionsOrder: newOrder });
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

export const sortedGroups = orderedDerived<CollectionGroup>(groups, 'groupsOrder');

export const groupCollections = derived([collections, groups, appConfig], ([$collections, $groups]) => {
  const result: Record<string, Collection[]> = {};
  for (const [gid, group] of Object.entries($groups)) {
    const orderedIds = group.collectionIds.filter(cid => {
      const col = $collections[cid];
      return col !== undefined && col.groupId === gid;
    });
    const orderedSet = new Set(orderedIds);
    // Start with ordered collections whose groupId matches
    const cols: Collection[] = orderedIds.map(cid => $collections[cid]);
    // Append any collections whose groupId points here but missing from collectionIds
    for (const col of Object.values($collections)) {
      if (col.groupId === gid && !orderedSet.has(col.id)) {
        cols.push(col);
      }
    }
    result[gid] = cols;
  }
  return result;
});

export const ungroupedCollections = derived(
  [sortedCollections, groups],
  ([$sortedCollections, $groups]) => {
    const groupIds = new Set(Object.keys($groups));
    return $sortedCollections.filter(c => !c.groupId || !groupIds.has(c.groupId));
  }
);

export async function storeGroup(group: CollectionGroup) {
  const inbox = getInbox();
  const clean = cleanForStorage(group);
  const isNew = !get(groups)[clean.id];
  await inbox.storeGroup(clean);
  groups.update(current => ({ ...current, [clean.id]: clean }));

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
  const hasCollections = Object.values(allCollections).some(col => col.groupId === id);
  if (hasCollections) {
    console.warn('[inbox] cannot delete group with collections — remove them first');
    return false;
  }

  const prevGroups = get(groups);
  try {
    await inbox.removeGroup(id);
    groups.update(current => {
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

export async function moveCollectionToGroup(collectionId: string, groupId: string | undefined) {
  const inbox = getInbox();

  // Snapshot stores for rollback
  const prevCollections = get(collections);
  const prevGroups = get(groups);

  let col: Collection | undefined;
  let oldGroupId: string | undefined;

  collections.update(current => {
    const next = { ...current };
    if (next[collectionId]) {
      oldGroupId = next[collectionId].groupId;
      const updated = { ...next[collectionId] };
      if (groupId) {
        updated.groupId = groupId;
      } else {
        delete (updated as any).groupId;
      }
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
      groups.update(current => {
        const grp = current[oldGroupId!];
        if (grp) {
          return { ...current, [oldGroupId!]: { ...grp, collectionIds: grp.collectionIds.filter(id => id !== collectionId) } };
        }
        return current;
      });
      const oldGrp = get(groups)[oldGroupId];
      if (oldGrp) {
        await inbox.storeGroup(cleanForStorage(oldGrp));
      }
    }

    // Add to new group
    if (groupId) {
      groups.update(current => {
        const grp = current[groupId];
        if (grp && !grp.collectionIds.includes(collectionId)) {
          return { ...current, [groupId]: { ...grp, collectionIds: [...grp.collectionIds, collectionId] } };
        }
        return current;
      });
      const newGrp = get(groups)[groupId];
      if (newGrp) {
        await inbox.storeGroup(cleanForStorage(newGrp));
      }
    }
  } catch (e) {
    collections.set(prevCollections);
    groups.set(prevGroups);
    console.error('[inbox] moveCollectionToGroup failed, rolling back:', e);
    throw e;
  }
}

/**
 * Find an existing "Uncategorized<N>" group, or create a fresh one and return
 * its id. Uncategorized<N> groups are auto-created homes for collections the
 * user added without picking a group — every collection needs a group, and we
 * keep these auto-homes obviously distinct from user-named groups by
 * convention. The numbering is naive on purpose (this is an edge case): we
 * scan existing groups for `Uncategorized\d+`, take the lowest number, and
 * create `Uncategorized1` if none exist.
 */
async function findOrCreateUncategorizedGroup(): Promise<string> {
  const allGroups = get(groups);
  const matches = Object.values(allGroups)
    .map(g => {
      const m = g.name.match(/^Uncategorized(\d+)$/);
      return m ? { id: g.id, n: Number(m[1]) } : null;
    })
    .filter((x): x is { id: string; n: number } => x !== null)
    .sort((a, b) => a.n - b.n);
  if (matches.length > 0) return matches[0].id;

  const group: CollectionGroup = {
    id: crypto.randomUUID(),
    name: 'Uncategorized1',
    collectionIds: [],
    createdAt: new Date().toISOString(),
  };
  await storeGroup(group);
  return group.id;
}

/**
 * Create a collection, ensuring it ends up inside a group. If the caller
 * already picked a group (`col.groupId` set), we honour it and wire up the
 * group ↔ collection back-references via `moveCollectionToGroup`. Otherwise
 * we route the collection into an `Uncategorized<N>` group (creating one if
 * needed) so the "every collection has a group" invariant always holds.
 *
 * Returns the stored collection (with `groupId` filled in if we auto-assigned).
 */
export async function createCollection(col: Collection): Promise<Collection> {
  const targetGroupId = col.groupId ?? await findOrCreateUncategorizedGroup();
  const withGroup: Collection = { ...col, groupId: targetGroupId };
  await storeCollection(withGroup);
  await moveCollectionToGroup(withGroup.id, targetGroupId);
  return withGroup;
}

export async function reorderGroupCollections(groupId: string, newCollectionIds: string[]) {
  const inbox = getInbox();
  const prevGroups = get(groups);
  groups.update(current => {
    const grp = current[groupId];
    if (grp) {
      return { ...current, [groupId]: { ...grp, collectionIds: newCollectionIds } };
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

export async function reorderTodos(newOrder: string[]) {
  await updateConfig({ todosOrder: newOrder });
}

// ---- Group filter (toggle row) ----

/**
 * Sentinel id for the Uncategorized entry in the group filter bar and the
 * Collections page. Both surfaces treat Uncategorized as a peer of real groups
 * (same drag-sort list, same pill styling, same grouped section layout), so we
 * use a reserved id that cannot collide with a real group id and persist it
 * inside `groupsOrder` to record its position.
 *
 * Downstream consumers of `groupsOrder` — `sortedGroups`, `reorderGroups`,
 * `activeGroupIds` — only inspect ids that correspond to real stored groups,
 * so the sentinel is naturally ignored outside the filter bar and the
 * Collections page's `visibleGroupedCollections` derivation.
 */
export const UNCATEGORIZED_FILTER_ID = '__uncategorized';

/**
 * Sentinel id for the virtual "Uncategorized" collection rendered inside the
 * Uncategorized group section on the Collections page. It surfaces todos and
 * reference items that have no `collectionId` in the same visual shape as a
 * real collection (CollectionView), so users can see and interact with their
 * uncategorized items without the Collections page quietly hiding them.
 *
 * There is no backing Collection record — the virtual collection is computed
 * from the `items` store on the fly. CollectionView renders it in a restricted
 * mode (no edit button, no move-to-group menu, items saved with
 * `collectionId: undefined`) because editing/deleting the virtual bucket has
 * no meaning.
 */
export const UNCATEGORIZED_COLLECTION_ID = '__uncategorized_collection';

/**
 * Virtual Collection object that backs the Uncategorized bucket's CollectionView.
 * `itemIds` lists every straggler: todos without a `collectionId` (todos can't
 * live in the Inbox, so they all end up here) followed by reference items
 * explicitly marked `uncategorized: true` (typically orphaned by a collection
 * deletion). Inbox refs (no `collectionId`, no flag) never surface here.
 *
 * When there are no stragglers this collection is empty — consumers should
 * check `hasUncategorizedItems` and hide the Uncategorized surface entirely
 * rather than rendering an empty bucket, since Uncategorized is a dynamic
 * artifact of leftover items rather than a first-class collection.
 */
export const uncategorizedVirtualCollection = derived(
  [todoItems, uncategorizedReferenceItems],
  ([$todos, $refs]): Collection => ({
    id: UNCATEGORIZED_COLLECTION_ID,
    name: 'Uncategorized',
    // Muted accent — this bucket is a fallback rather than a user-created
    // collection, so it shouldn't compete visually with real collections.
    color: '#9ca3af',
    itemIds: [...$todos.map(t => t.id), ...$refs.map(r => r.id)],
    createdAt: new Date(0).toISOString(),
  })
);

/**
 * True iff there are any items that belong in the Uncategorized bucket. The
 * Uncategorized pill (GroupFilterBar) and section (CollectionsPage) use this
 * to decide whether to render at all — Uncategorized isn't a persistent
 * category, it only exists when the system has stragglers to surface. A fresh
 * user with no orphaned refs and no uncollected todos sees no Uncategorized
 * surface anywhere.
 */
export const hasUncategorizedItems = derived(
  uncategorizedVirtualCollection,
  ($virtual) => $virtual.itemIds.length > 0
);

/**
 * Is the "Uncategorized" filter pill currently ON?
 * Defaults to true — when the config flag is unset, uncategorized todos and
 * collections are visible (matches the previous behaviour where the
 * Uncategorized tile was always rendered on the Todos page).
 */
export const uncategorizedFilterActive = derived(appConfig, ($config) =>
  $config.uncategorizedFilterActive !== false
);

/**
 * Set of group IDs currently active (visible) in the filter row.
 * When `activeGroupFilters` is undefined in config, all groups default to active.
 */
export const activeGroupIds = derived(
  [sortedGroups, appConfig],
  ([$sortedGroups, $config]) => {
    const all = new Set($sortedGroups.map(g => g.id));
    if ($config.activeGroupFilters === undefined) return all;
    const filtered = new Set<string>();
    for (const id of $config.activeGroupFilters) {
      if (all.has(id)) filtered.add(id);
    }
    return filtered;
  }
);

/**
 * Group + collection bundle, in the configured group order, filtered by
 * activeGroupIds. Within each group, collections preserve the configured
 * order from groupCollections.
 *
 * A synthetic "Uncategorized" section is folded into this list when there are
 * stragglers AND the uncategorized filter pill is on — identified by
 * `group.id === UNCATEGORIZED_FILTER_ID`. It holds ungrouped collections
 * (collections with no groupId, or with a groupId pointing to a non-existent
 * group). Uncategorized is dynamic: a user with no straggler items (and no
 * ungrouped collections surfaced alongside) never sees this section.
 */
export interface VisibleGroupSection {
  group: CollectionGroup;
  collections: Collection[];
  /**
   * Optional virtual collection rendered above the draggable list of real
   * collections in this section. Currently only populated for the Uncategorized
   * section, where it surfaces items with no `collectionId` as a pseudo-
   * collection (read-only, not draggable, cannot be edited or deleted). Consumer
   * components should render it outside the real-collection drag zone.
   */
  virtualCollection?: Collection;
}

export const visibleGroupedCollections = derived(
  [sortedGroups, groupCollections, activeGroupIds, ungroupedCollections, uncategorizedFilterActive, uncategorizedVirtualCollection, hasUncategorizedItems, appConfig],
  ([$sortedGroups, $groupCollections, $activeGroupIds, $ungroupedCollections, $uncatActive, $uncatVirtual, $hasUncat, $config]): VisibleGroupSection[] => {
    const sections: VisibleGroupSection[] = [];
    const realById = new Map($sortedGroups.map(g => [g.id, g]));
    const order = $config.groupsOrder ?? [];
    const seen = new Set<string>();

    // Uncategorized is a dynamic surface: it only exists when the system has
    // something to put there. "Something" means either straggler items (todos
    // without a collection, or orphaned refs) OR ungrouped collections the
    // user might want to see alongside — without either, the section would be
    // a confusing empty heading. Real groups keep rendering when active even
    // if empty because the user created them explicitly; Uncategorized has no
    // such user intent behind it.
    const uncatHasContent = $hasUncat || $ungroupedCollections.length > 0;

    // Synthetic group for the Uncategorized section. Uses the same sentinel
    // id as the filter pill so ordering/placement flows through groupsOrder
    // without any special-casing at consumer sites. The virtual Uncategorized
    // collection rides along on `virtualCollection` so CollectionsPage can
    // render it alongside real ungrouped collections.
    const uncatSection: VisibleGroupSection = {
      group: {
        id: UNCATEGORIZED_FILTER_ID,
        name: 'Uncategorized',
        collectionIds: $ungroupedCollections.map(c => c.id),
        createdAt: new Date(0).toISOString(),
      },
      collections: $ungroupedCollections,
      // Only attach the virtual pseudo-collection when there are actual
      // stragglers — otherwise the section just hosts ungrouped collections
      // and shouldn't add an empty "Uncategorized" pseudo-tile on top.
      virtualCollection: $hasUncat ? $uncatVirtual : undefined,
    };

    const pushReal = (g: CollectionGroup) => {
      if (!$activeGroupIds.has(g.id)) return;
      sections.push({ group: g, collections: $groupCollections[g.id] ?? [] });
    };

    const pushUncat = () => {
      if (!uncatHasContent) return;
      if ($uncatActive) sections.push(uncatSection);
    };

    // Walk the persisted filter-bar order so the Uncategorized section lines
    // up with its pill. Real groups not yet in the order (newly created) are
    // appended afterwards.
    for (const id of order) {
      if (seen.has(id)) continue;
      if (id === UNCATEGORIZED_FILTER_ID) {
        pushUncat();
        seen.add(id);
      } else {
        const g = realById.get(id);
        if (g) {
          pushReal(g);
          seen.add(id);
        }
      }
    }
    for (const g of $sortedGroups) {
      if (!seen.has(g.id)) {
        pushReal(g);
        seen.add(g.id);
      }
    }
    // Default the Uncategorized slot to the end when the sentinel has never
    // been persisted — same fallback the filter bar uses for new users.
    if (!seen.has(UNCATEGORIZED_FILTER_ID)) pushUncat();

    return sections;
  }
);

/**
 * Toggle a group's filter on/off. Persists to config.
 * If activeGroupFilters was undefined (default-all), this materializes the
 * current set first, then flips the requested id.
 */
export async function toggleGroupFilter(groupId: string): Promise<void> {
  const config = get(appConfig);
  const allGroupIds = get(sortedGroups).map(g => g.id);
  const current = config.activeGroupFilters ?? allGroupIds;
  const next = current.includes(groupId)
    ? current.filter(id => id !== groupId)
    : [...current, groupId];
  await updateConfig({ activeGroupFilters: next });
}

/** Set the active group filter list to exactly these IDs. Persists to config. */
export async function setActiveGroupFilters(ids: string[]): Promise<void> {
  // Dedupe and only keep ids that correspond to real groups.
  const allGroupIds = new Set(get(sortedGroups).map(g => g.id));
  const filtered = Array.from(new Set(ids)).filter(id => allGroupIds.has(id));
  const current = get(appConfig).activeGroupFilters;
  // Skip if equal to current (avoids URL ↔ config write loops)
  if (current && current.length === filtered.length && current.every((v, i) => v === filtered[i])) {
    return;
  }
  await updateConfig({ activeGroupFilters: filtered });
}

/** Flip the Uncategorized filter pill. */
export async function toggleUncategorizedFilter(): Promise<void> {
  const current = get(appConfig).uncategorizedFilterActive !== false;
  await updateConfig({ uncategorizedFilterActive: !current });
}

/**
 * Persist a new order for the Uncategorized section on the Collections page.
 * Ungrouped collections take their order from `collectionsOrder` (via
 * `sortedCollections` → `ungroupedCollections`); grouped collections rely on
 * `group.collectionIds` for their order, so overwriting `collectionsOrder`
 * with just the ungrouped ids is safe.
 */
export async function reorderUngroupedCollections(newOrder: string[]) {
  await updateConfig({ collectionsOrder: newOrder });
}

// ---- Flat Todos page: all todos across all collections ----

/**
 * Every item that represents a todo — across collections and "uncategorized"
 * (no collectionId). Not sorted or filtered; callers should derive from
 * `visibleTodos` instead when rendering the Todos page.
 */
export const allTodos = derived(items, ($items) => {
  return Object.values($items).filter(i => i.isTodo || i.type === 'todo');
});

/** Convenience: open todos across all collections, for badges/counts. */
export const openTodos = derived(allTodos, ($allTodos) =>
  $allTodos.filter(t => !t.completed)
);

/**
 * Todos visible on the flat Todos page, honouring both the group-filter row
 * and the uncategorized filter pill. Sorted by `todosGlobalOrder`; ids missing
 * from that order fall back to newest-first on `createdAt`. Completed and open
 * todos are mixed — the page splits them at render time.
 */
export const visibleTodos = derived(
  [allTodos, collections, sortedGroups, activeGroupIds, uncategorizedFilterActive, appConfig],
  ([$allTodos, $collections, $sortedGroups, $activeGroupIds, $uncatActive, $config]) => {
    const groupIdSet = new Set($sortedGroups.map(g => g.id));

    // A todo is visible iff:
    //  - it has no collectionId and the uncategorized pill is on, OR
    //  - it's in a collection whose group is active (or the collection is
    //    ungrouped / orphan-grouped — those are always visible alongside
    //    active groups, mirroring CollectionsPage semantics).
    const filtered = $allTodos.filter(todo => {
      if (!todo.collectionId) return $uncatActive;
      const col = $collections[todo.collectionId];
      if (!col) return $uncatActive; // orphan: the collection was deleted — treat as uncategorized
      if (!col.groupId || !groupIdSet.has(col.groupId)) return true; // ungrouped collection
      return $activeGroupIds.has(col.groupId);
    });

    return sortWithConfiguredOrder(
      filtered,
      $config.todosGlobalOrder,
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
);

/**
 * Persist a new order for todos on the flat Todos page. Only stores the ids
 * the caller passed — any todos that appear later fall back to createdAt
 * ordering via `sortWithConfiguredOrder`.
 */
export async function reorderTodosGlobal(newOrder: string[]) {
  await updateConfig({ todosGlobalOrder: newOrder });
}
