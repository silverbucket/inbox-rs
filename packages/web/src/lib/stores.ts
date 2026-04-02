import { writable, derived } from 'svelte/store';
import type { InboxItem, AppConfig, Collection } from '@inbox-rs/rs-module';
import { migrator } from '@inbox-rs/rs-module';
import rs from './rs';

/** Blob URLs for files that were just uploaded (available before remote sync completes) */
export const blobUrls = writable<Record<string, string>>({});

export const connected = writable(false);
export const syncing = writable(false);
export const items = writable<Record<string, InboxItem>>({});
export const appConfig = writable<AppConfig>({});
export const collections = writable<Record<string, Collection>>({});
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
        valid[key] = col as Collection;
      }
    }
    collections.set(valid);
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

rs.on('connected', () => {
  connected.set(true);
  void loadItems();
  void loadConfig();
  void loadCollections();
});

rs.on('disconnected', () => {
  connected.set(false);
  items.set({});
  appConfig.set({});
  collections.set({});
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
  appConfig.update(current => {
    const updated = { ...current, ...patch };
    inbox.setConfig(updated);
    return updated;
  });
}

// Update items on remote/local changes
const inbox = (rs as any).inbox;
if (inbox) {
  inbox.onChange(() => {
    void loadItems();
    void loadCollections();
  });
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
    const order = $config.collectionsOrder;
    return cols.sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
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
}

export async function moveItemToCollection(itemId: string, collectionId: string | undefined) {
  const inbox = (rs as any).inbox;
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
}

export async function removeItemFromCollection(itemId: string, collectionId: string) {
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
