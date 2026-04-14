import { writable, derived, get } from 'svelte/store';
import type { Writable, Readable } from 'svelte/store';
import type { InboxItem, AppConfig, UserSettings, Collection, CollectionGroup } from '@inbox-rs/rs-module';
import { migrator } from '@inbox-rs/rs-module';
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
export const appConfig = writable<AppConfig>({});
export const userSettings = writable<UserSettings>({});
export const collections = writable<Record<string, Collection>>({});
export const groups = writable<Record<string, CollectionGroup>>({});
/** Derived from loaded items using rs-migrate's getPending */
export const pendingMigrationCount = derived(items, ($items) => {
  const docs = Object.values($items);
  if (docs.length === 0) return 0;
  const pending = migrator.getPending('items', docs);
  let count = 0;
  for (const r of pending) {
    if (r.pendingMigrations.length > 0) count++;
  }
  return count;
});

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
    const items = Object.values($entities);
    const order = $config[configOrderKey];
    if (order?.length) {
      const orderIndex = new Map(order.map((id, i) => [id, i]));
      return items.sort((a, b) => (orderIndex.get(a.id) ?? Infinity) - (orderIndex.get(b.id) ?? Infinity));
    }
    return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  });
}

async function removeFromOrderConfig(id: string, key: 'collectionsOrder' | 'groupsOrder') {
  const currentOrder = get(appConfig)[key] ?? [];
  if (currentOrder.includes(id)) {
    await updateConfig({ [key]: currentOrder.filter((x: string) => x !== id) });
  }
}

// ---- Loaders ----

async function loadItems() {
  const inbox = getInbox();
  if (!inbox) return;
  try {
    const all = await inbox.getAll();
    const valid: Record<string, InboxItem> = {};
    for (const [key, item] of Object.entries(all)) {
      if (item && typeof item === 'object' && 'id' in item && (item as InboxItem).id) {
        valid[key] = item as InboxItem;
      }
    }
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
rs.on('wire-done', hideSync);
rs.on('sync-done', hideSync);

// Debug: log sync activity
rs.on('sync-req-done', (e: any) => {
  console.log('[inbox] sync-req-done, tasks remaining:', e?.tasksRemaining);
});
rs.on('sync-done', (e: any) => {
  console.log('[inbox] sync-done:', e);
});
rs.on('wire-busy', () => console.log('[inbox] wire-busy'));
rs.on('wire-done', () => console.log('[inbox] wire-done'));

let reloadTimeout: ReturnType<typeof setTimeout> | undefined;

rs.on('connected', () => {
  connected.set(true);
  const addr =
    (rs as any).remote?.userAddress ||
    localStorage.getItem('inbox-rs:userAddress') ||
    '';
  userAddress.set(addr);
  void loadItems();
  void loadConfig();
  void loadUserSettings();
  void loadCollections();
  void loadGroups();
});

rs.on('disconnected', () => {
  connected.set(false);
  userAddress.set('');
  localStorage.removeItem('inbox-rs:userAddress');
  if (reloadTimeout) {
    clearTimeout(reloadTimeout);
    reloadTimeout = undefined;
  }
  items.set({});
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

// Update items on remote/local changes — debounced to avoid redundant reloads during sync
const inboxRef = getInbox();
function scheduleReload() {
  if (reloadTimeout) clearTimeout(reloadTimeout);
  reloadTimeout = setTimeout(() => {
    reloadTimeout = undefined;
    void loadItems();
    void loadCollections();
    void loadGroups();
  }, 100);
}
if (inboxRef) {
  inboxRef.onChange(scheduleReload);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (rs as any).remote?.connected) {
    rs.startSync();
  }
});

// ---- Derived stores ----

export const sortedItems = derived(items, ($items) => {
  return Object.values($items)
    .filter(i => !i.isTodo && i.type !== 'todo' && !i.collectionId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
});

export const todoItems = derived(items, ($items) => {
  return Object.values($items)
    .filter(i => (i.isTodo || i.type === 'todo') && !i.collectionId)
    .sort((a, b) => {
      const aDone = !!a.completed;
      const bDone = !!b.completed;
      if (aDone !== bDone) return aDone ? 1 : -1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
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
        if (!item || !(item.isTodo || item.type === 'todo') || item.completed) continue;
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
      .filter((i): i is InboxItem => i !== undefined);
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
    console.log('[inbox] stored file, triggering sync:', item.filePath);
    rs.startSync();
  }
  items.update(current => ({ ...current, [cleanItem.id]: cleanItem }));
}

export async function deleteItem(id: string, item?: InboxItem) {
  const inbox = getInbox();
  await inbox.remove(id, item);
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

  try {
    await inbox.store(cleanForStorage(item));

    // Update source collection's itemIds
    if (oldCollectionId) {
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

export const groupCollections = derived([collections, groups, appConfig], ([$collections, $groups, $config]) => {
  const result: Record<string, Collection[]> = {};
  for (const [gid, group] of Object.entries($groups)) {
    result[gid] = group.collectionIds
      .map(cid => $collections[cid])
      .filter((c): c is Collection => c !== undefined);
  }
  return result;
});

/** Collections that don't belong to any group */
export const ungroupedCollections = derived([sortedCollections, groups], ([$sortedCollections, $groups]) => {
  const grouped = new Set<string>();
  for (const group of Object.values($groups)) {
    for (const cid of group.collectionIds) grouped.add(cid);
  }
  return $sortedCollections.filter(c => !grouped.has(c.id));
});

export async function storeGroup(group: CollectionGroup) {
  const inbox = getInbox();
  const clean = cleanForStorage(group);
  await inbox.storeGroup(clean);
  groups.update(current => ({ ...current, [clean.id]: clean }));
}

export async function deleteGroup(id: string) {
  const inbox = getInbox();
  const prevCollections = get(collections);
  const prevGroups = get(groups);

  // Unset groupId on orphaned collections
  let orphanedCols: Collection[] = [];
  collections.update(current => {
    const next = { ...current };
    for (const key of Object.keys(next)) {
      if (next[key].groupId === id) {
        const updated = { ...next[key] };
        delete (updated as any).groupId;
        next[key] = updated as Collection;
        orphanedCols.push(updated as Collection);
      }
    }
    return next;
  });

  try {
    for (const col of orphanedCols) {
      await inbox.storeCollection(cleanForStorage(col));
    }
    await inbox.removeGroup(id);
    groups.update(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    await removeFromOrderConfig(id, 'groupsOrder');
  } catch (e) {
    collections.set(prevCollections);
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
