import { writable, derived } from 'svelte/store';
import type { InboxItem } from '@inbox-rs/rs-module';
import rs from './rs';

export const connected = writable(false);
export const items = writable<Record<string, InboxItem>>({});

async function loadItems() {
  const inbox = (rs as any).inbox;
  const all = await inbox.getAll();
  items.set(all);
}

rs.on('connected', () => {
  connected.set(true);
  loadItems();
});

rs.on('disconnected', () => {
  connected.set(false);
  items.set({});
});

// Update items on remote/local changes
const inbox = (rs as any).inbox;
if (inbox) {
  inbox.onChange(() => {
    loadItems();
  });
}

export const sortedItems = derived(items, ($items) => {
  return Object.values($items)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
});

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
