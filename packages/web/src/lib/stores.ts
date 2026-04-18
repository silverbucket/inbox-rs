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

export const sortedItems = derived(items, ($items) => {
  return Object.values($items)
    .filter(i => !i.isTodo && i.type !== 'todo' && !i.collectionId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
});

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

export const sortedCollections = orderedDerived<Collection>(collections, 'collectionsOrder');

/** Todos from active collections, surfaced for the main todo list.
 *  Each todo is annotated with its source collection info. */
export interface ActiveCollectionTodo {
  item: InboxItem;
  collectionId: string;
  collectionName: string;
  collectionColor: string;
  groupName: string | undefined;
  groupColor: string | undefined;
}

export const activeCollectionTodos = derived(
  [items, sortedCollections, groups],
  ([$items, $sortedCollections, $groups]): ActiveCollectionTodo[] => {
    const MAX_PER_COLLECTION = 5;
    const result: ActiveCollectionTodo[] = [];
    const itemMap = new Map(Object.values($items).map(i => [i.id, i]));

    for (const col of $sortedCollections) {
      if (!col.active) continue;

      // Resolve group color if the collection belongs to a group
      const group = col.groupId ? $groups[col.groupId] : undefined;
      const groupColor = group?.color || undefined;
      const groupName = group?.name || undefined;

      // Collect open todos from this collection, stopping at MAX_PER_COLLECTION
      let count = 0;
      for (const id of col.itemIds) {
        if (count >= MAX_PER_COLLECTION) break;
        const item = itemMap.get(id);
        if (!item || item.collectionId !== col.id || !(item.isTodo || item.type === 'todo') || item.completed) continue;
        result.push({
          item,
          collectionId: col.id,
          collectionName: col.name,
          collectionColor: col.color || '#6366f1',
          groupName,
          groupColor,
        });
        count++;
      }
    }

    return result;
  }
);

export const collectionItems = derived([items, collections], ([$items, $collections]) => {
  const result: Record<string, InboxItem[]> = {};
  const itemMap = new Map(Object.values($items).map(i => [i.id, i]));
  for (const [cid, col] of Object.entries($collections)) {
    result[cid] = col.itemIds
      .map(id => itemMap.get(id))
      .filter((i): i is InboxItem => i !== undefined && i.collectionId === cid);
  }
  return result;
});

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

export async function deleteCollection(id: string) {
  const inbox = getInbox();
  const prevItems = get(items);
  const prevCollections = get(collections);

  // Return orphaned items to inbox
  let orphanedItems: InboxItem[] = [];
  items.update(current => {
    const next = { ...current };
    for (const key of Object.keys(next)) {
      if (next[key].collectionId === id) {
        const updated = { ...next[key] };
        delete (updated as any).collectionId;
        next[key] = updated as InboxItem;
        orphanedItems.push(updated as InboxItem);
      }
    }
    return next;
  });

  try {
    for (const item of orphanedItems) {
      await inbox.store(cleanForStorage(item));
    }
    await inbox.removeCollection(id);
    collections.update(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    await removeFromOrderConfig(id, 'collectionsOrder');
  } catch (e) {
    items.set(prevItems);
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
        } else {
          delete (updated as any).collectionId;
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
  await inbox.storeGroup(clean);
  groups.update(current => ({ ...current, [clean.id]: clean }));
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
