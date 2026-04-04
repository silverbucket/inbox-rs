import { writable, derived } from 'svelte/store';
import type { InboxItem, AppConfig, Collection, CollectionGroup } from '@inbox-rs/rs-module';
import { migrator } from '@inbox-rs/rs-module';
import rs from './rs';

/** Blob URLs for files that were just uploaded (available before remote sync completes) */
export const blobUrls = writable<Record<string, string>>({});

export const connected = writable(false);
export const syncing = writable(false);
export const items = writable<Record<string, InboxItem>>({});
export const appConfig = writable<AppConfig>({});
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

async function loadItems() {
  const inbox = (rs as any).inbox;
  if (!inbox) return;
  try {
    const all = await inbox.getAll();
    // Filter out invalid entries (folder listings, partial objects without id)
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
  const inbox = (rs as any).inbox;
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

async function loadCollections() {
  const inbox = (rs as any).inbox;
  if (!inbox) return;
  try {
    const all = await inbox.getAllCollections();
    const valid: Record<string, Collection> = {};
    for (const [key, col] of Object.entries(all)) {
      if (col && typeof col === 'object' && 'id' in col && (col as Collection).id) {
        const collection = col as Collection;
        if (key !== collection.id) continue;
        valid[key] = {
          ...collection,
          itemIds: Array.isArray(collection.itemIds) ? collection.itemIds : [],
        };
      }
    }
    collections.set(valid);
  } catch {
    // ignore
  }
}

async function loadGroups() {
  const inbox = (rs as any).inbox;
  if (!inbox) return;
  try {
    const all = await inbox.getAllGroups();
    const valid: Record<string, CollectionGroup> = {};
    for (const [key, grp] of Object.entries(all)) {
      if (grp && typeof grp === 'object' && 'id' in grp && (grp as CollectionGroup).id) {
        const group = grp as CollectionGroup;
        if (key !== group.id) continue;
        valid[key] = {
          ...group,
          collectionIds: Array.isArray(group.collectionIds) ? group.collectionIds : [],
        };
      }
    }
    groups.set(valid);
  } catch {
    // ignore
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
  void loadItems();
  void loadConfig();
  void loadCollections();
  void loadGroups();
});

rs.on('disconnected', () => {
  connected.set(false);
  if (reloadTimeout) {
    clearTimeout(reloadTimeout);
    reloadTimeout = undefined;
  }
  items.set({});
  appConfig.set({});
  collections.set({});
  groups.set({});
});

export async function runAllMigrations() {
  const inbox = (rs as any).inbox;
  if (!inbox) return;
  try {
    await inbox.runAllMigrations();
  } catch (e) {
    console.error('[inbox] migration failed:', e);
  }
  await loadItems();
}

export async function updateConfig(patch: Partial<AppConfig>) {
  const inbox = (rs as any).inbox;
  let currentConfig: AppConfig = {};
  appConfig.subscribe(c => { currentConfig = c; })();
  const updated = { ...currentConfig, ...patch };
  appConfig.set(updated);
  try {
    await inbox.setConfig(JSON.parse(JSON.stringify(updated)));
  } catch (e) {
    appConfig.set(currentConfig);
    console.error('[inbox] failed to persist config update:', e);
    throw e;
  }
}

// Update items on remote/local changes — debounced to avoid redundant reloads during sync
const inboxRef = (rs as any).inbox;
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

export const sortedCollections = derived([collections, appConfig], ([$collections, $config]) => {
  const cols = Object.values($collections);
  if ($config.collectionsOrder?.length) {
    const orderIndex = new Map($config.collectionsOrder.map((id, i) => [id, i]));
    return cols.sort((a, b) => {
      const ai = orderIndex.get(a.id) ?? Infinity;
      const bi = orderIndex.get(b.id) ?? Infinity;
      return ai - bi;
    });
  }
  return cols.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
});

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

export async function storeItem(item: InboxItem, fileData?: ArrayBuffer) {
  const inbox = (rs as any).inbox;
  // Strip undefined values — remoteStorage schema validator rejects them
  const cleanItem = JSON.parse(JSON.stringify(item)) as InboxItem;
  await inbox.store(cleanItem, fileData);
  if (fileData && 'filePath' in item && item.filePath && 'mimeType' in item) {
    const blob = new Blob([fileData], { type: (item as any).mimeType });
    const url = URL.createObjectURL(blob);
    blobUrls.update(current => ({ ...current, [item.filePath as string]: url }));
    // Force sync to push file to server immediately
    console.log('[inbox] stored file, triggering sync:', item.filePath);
    rs.startSync();
  }
  items.update(current => ({ ...current, [cleanItem.id]: cleanItem }));
}

export async function deleteItem(id: string, item?: InboxItem) {
  const inbox = (rs as any).inbox;
  await inbox.remove(id, item);
  items.update(current => {
    const next = { ...current };
    // Remove by matching id in values
    for (const key of Object.keys(next)) {
      if (next[key].id === id) {
        delete next[key];
        break;
      }
    }
    return next;
  });
}

export async function storeCollection(collection: Collection) {
  const inbox = (rs as any).inbox;
  const clean = JSON.parse(JSON.stringify(collection)) as Collection;
  await inbox.storeCollection(clean);
  collections.update(current => ({ ...current, [clean.id]: clean }));
}

export async function deleteCollection(id: string) {
  const inbox = (rs as any).inbox;
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
  // Persist orphaned items without collectionId
  for (const item of orphanedItems) {
    const cleanItem = JSON.parse(JSON.stringify(item)) as InboxItem;
    await inbox.store(cleanItem);
  }
  await inbox.removeCollection(id);
  collections.update(current => {
    const next = { ...current };
    delete next[id];
    return next;
  });
  // Clean up collectionsOrder via updateConfig for consistent rollback on failure
  let currentOrder: string[] = [];
  appConfig.subscribe(c => { currentOrder = c.collectionsOrder ?? []; })();
  if (currentOrder.includes(id)) {
    await updateConfig({ collectionsOrder: currentOrder.filter(cid => cid !== id) });
  }
}

export async function moveItemToCollection(itemId: string, collectionId: string | undefined) {
  const inbox = (rs as any).inbox;

  // Validate target collection exists
  if (collectionId) {
    let exists = false;
    collections.subscribe(c => { exists = !!c[collectionId]; })();
    if (!exists) {
      console.error('[inbox] moveItemToCollection: target collection does not exist:', collectionId);
      return;
    }
  }

  // Snapshot stores for rollback
  let prevItems: Record<string, InboxItem> = {};
  items.subscribe(v => { prevItems = v; })();
  let prevCollections: Record<string, Collection> = {};
  collections.subscribe(v => { prevCollections = v; })();

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
    // Persist item
    const cleanItem = JSON.parse(JSON.stringify(item)) as InboxItem;
    await inbox.store(cleanItem);

    // Update source collection's itemIds
    if (oldCollectionId) {
      collections.update(current => {
        const col = current[oldCollectionId!];
        if (col) {
          const updated = { ...col, itemIds: col.itemIds.filter(id => id !== itemId) };
          return { ...current, [oldCollectionId!]: updated };
        }
        return current;
      });
      let sourceCol: Collection | undefined;
      collections.subscribe(c => { sourceCol = c[oldCollectionId!]; })();
      if (sourceCol) {
        await inbox.storeCollection(JSON.parse(JSON.stringify(sourceCol)));
      }
    }

    // Update target collection's itemIds
    if (collectionId) {
      collections.update(current => {
        const col = current[collectionId];
        if (col && !col.itemIds.includes(itemId)) {
          const updated = { ...col, itemIds: [...col.itemIds, itemId] };
          return { ...current, [collectionId]: updated };
        }
        return current;
      });
      let targetCol: Collection | undefined;
      collections.subscribe(c => { targetCol = c[collectionId]; })();
      if (targetCol) {
        await inbox.storeCollection(JSON.parse(JSON.stringify(targetCol)));
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
  const inbox = (rs as any).inbox;
  collections.update(current => {
    const col = current[collectionId];
    if (col) {
      return { ...current, [collectionId]: { ...col, itemIds: newItemIds } };
    }
    return current;
  });
  let col: Collection | undefined;
  collections.subscribe(c => { col = c[collectionId]; })();
  if (col) {
    await inbox.storeCollection(JSON.parse(JSON.stringify(col)));
  }
}

export async function reorderCollections(newOrder: string[]) {
  await updateConfig({ collectionsOrder: newOrder });
}

// ---- Groups ----

export const sortedGroups = derived([groups, appConfig], ([$groups, $config]) => {
  const grps = Object.values($groups);
  if ($config.groupsOrder?.length) {
    const orderIndex = new Map($config.groupsOrder.map((id, i) => [id, i]));
    return grps.sort((a, b) => {
      const ai = orderIndex.get(a.id) ?? Infinity;
      const bi = orderIndex.get(b.id) ?? Infinity;
      return ai - bi;
    });
  }
  return grps.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
});

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
  const inbox = (rs as any).inbox;
  const clean = JSON.parse(JSON.stringify(group)) as CollectionGroup;
  await inbox.storeGroup(clean);
  groups.update(current => ({ ...current, [clean.id]: clean }));
}

export async function deleteGroup(id: string) {
  const inbox = (rs as any).inbox;
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
  for (const col of orphanedCols) {
    const clean = JSON.parse(JSON.stringify(col)) as Collection;
    await inbox.storeCollection(clean);
  }
  await inbox.removeGroup(id);
  groups.update(current => {
    const next = { ...current };
    delete next[id];
    return next;
  });
  // Clean up groupsOrder via updateConfig for consistent rollback on failure
  let currentOrder: string[] = [];
  appConfig.subscribe(c => { currentOrder = c.groupsOrder ?? []; })();
  if (currentOrder.includes(id)) {
    await updateConfig({ groupsOrder: currentOrder.filter(gid => gid !== id) });
  }
}

export async function moveCollectionToGroup(collectionId: string, groupId: string | undefined) {
  const inbox = (rs as any).inbox;

  // Snapshot stores for rollback
  let prevCollections: Record<string, Collection> = {};
  collections.subscribe(v => { prevCollections = v; })();
  let prevGroups: Record<string, CollectionGroup> = {};
  groups.subscribe(v => { prevGroups = v; })();

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
    await inbox.storeCollection(JSON.parse(JSON.stringify(col)));

    // Remove from old group
    if (oldGroupId) {
      groups.update(current => {
        const grp = current[oldGroupId!];
        if (grp) {
          return { ...current, [oldGroupId!]: { ...grp, collectionIds: grp.collectionIds.filter(id => id !== collectionId) } };
        }
        return current;
      });
      let oldGrp: CollectionGroup | undefined;
      groups.subscribe(g => { oldGrp = g[oldGroupId!]; })();
      if (oldGrp) {
        await inbox.storeGroup(JSON.parse(JSON.stringify(oldGrp)));
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
      let newGrp: CollectionGroup | undefined;
      groups.subscribe(g => { newGrp = g[groupId]; })();
      if (newGrp) {
        await inbox.storeGroup(JSON.parse(JSON.stringify(newGrp)));
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
  const inbox = (rs as any).inbox;
  groups.update(current => {
    const grp = current[groupId];
    if (grp) {
      return { ...current, [groupId]: { ...grp, collectionIds: newCollectionIds } };
    }
    return current;
  });
  let grp: CollectionGroup | undefined;
  groups.subscribe(g => { grp = g[groupId]; })();
  if (grp) {
    await inbox.storeGroup(JSON.parse(JSON.stringify(grp)));
  }
}

export async function reorderGroups(newOrder: string[]) {
  await updateConfig({ groupsOrder: newOrder });
}
