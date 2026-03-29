import { writable, derived } from 'svelte/store';
import type { InboxItem, AppConfig } from '@inbox-rs/rs-module';
import { migrator } from '@inbox-rs/rs-module';
import rs from './rs';

/** Blob URLs for files that were just uploaded (available before remote sync completes) */
export const blobUrls = writable<Record<string, string>>({});

export const connected = writable(false);
export const syncing = writable(false);
export const items = writable<Record<string, InboxItem>>({});
export const appConfig = writable<AppConfig>({});
/** Derived from loaded items using rs-migrate's getPending */
export const pendingMigrationCount = derived(items, ($items) => {
  const docs = Object.values($items);
  if (docs.length === 0) return 0;
  return migrator.getPending('items', docs).filter(r => r.pendingMigrations.length > 0).length;
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
});

rs.on('disconnected', () => {
  connected.set(false);
  items.set({});
  appConfig.set({});
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
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (rs as any).remote?.connected) {
    rs.startSync();
  }
});

export const sortedItems = derived(items, ($items) => {
  return Object.values($items)
    .filter(i => !i.isTodo && i.type !== 'todo')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
});

export const todoItems = derived(items, ($items) => {
  return Object.values($items)
    .filter(i => i.isTodo || i.type === 'todo')
    .sort((a, b) => {
      const aDone = !!a.completed;
      const bDone = !!b.completed;
      if (aDone !== bDone) return aDone ? 1 : -1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
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
  items.update(current => ({ ...current, [item.id]: item }));
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
