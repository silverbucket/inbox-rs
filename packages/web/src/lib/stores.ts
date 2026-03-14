import { writable, derived } from 'svelte/store';
import type { InboxItem } from '@inbox-rs/rs-module';
import rs from './rs';

export const connected = writable(false);
export const items = writable<Record<string, InboxItem>>({});

async function loadItems() {
  const inbox = (rs as any).inbox;
  if (!inbox) return;
  try {
    const all = await inbox.getAll();
    items.set(all);
  } catch {
    // RS sync/fetch error — keep existing items
  }
}

rs.on('connected', () => {
  connected.set(true);
  void loadItems();
});

rs.on('disconnected', () => {
  connected.set(false);
  items.set({});
});

// Update items on remote/local changes
const inbox = (rs as any).inbox;
if (inbox) {
  inbox.onChange(() => {
    void loadItems();
  });
}

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
  await inbox.store(item, fileData);
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
