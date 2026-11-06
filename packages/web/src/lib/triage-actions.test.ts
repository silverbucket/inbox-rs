import type { Collection, InboxItem } from '@inbox-rs/rs-module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { showToast, store } = vi.hoisted(() => ({
  showToast: vi.fn(),
  store: { items: {} as Record<string, InboxItem> },
}));

vi.mock('./toast', () => ({ showToast }));
vi.mock('./collection-suggest', () => ({ recordCollectionUse: vi.fn() }));
vi.mock('./stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    items: readable(store.items),
    flushItemChanges: vi.fn(),
    moveItemToCollection: vi.fn(async (id: string, collectionId?: string) => {
      store.items[id] = { ...store.items[id], collectionId };
    }),
    setItemArchived: vi.fn(async (id: string, archived: boolean) => {
      store.items[id] = { ...store.items[id], archived };
    }),
    restoreItem: vi.fn(async ({ before }: { before: InboxItem }) => {
      store.items[before.id] = before;
      return true;
    }),
    triageToTodo: vi.fn(),
  };
});

import { fileItem, setArchived } from './triage-actions';

const note: InboxItem = {
  id: 'n1',
  type: 'note',
  title: 'A note',
  body: 'A note',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const shelf = { id: 'c1', name: 'Shelf' } as Collection;

/** Click the Undo on the last toast and let the restore settle. */
async function undo() {
  const action = showToast.mock.calls.at(-1)?.[1];
  expect(action?.label).toBe('Undo');
  action.run();
  await vi.waitFor(() => expect(store.items.n1).toEqual(note));
}

describe('organize actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const id of Object.keys(store.items)) delete store.items[id];
    store.items.n1 = { ...note };
  });

  it('files into a collection with "Filed to <name>" and an Undo', async () => {
    await expect(fileItem(note, shelf)).resolves.toBe(true);
    expect(showToast.mock.calls.at(-1)?.[0]).toBe('Filed to Shelf');
    expect(store.items.n1.collectionId).toBe('c1');
    await undo();
  });

  it('moves back to the inbox with an Undo', async () => {
    store.items.n1 = { ...note, collectionId: 'c1' };
    await fileItem(store.items.n1, undefined);
    expect(showToast.mock.calls.at(-1)?.[0]).toBe('Moved to Inbox');
    expect(showToast.mock.calls.at(-1)?.[1]?.label).toBe('Undo');
  });

  it('archives and restores with an Undo either way', async () => {
    await expect(setArchived(note, true)).resolves.toBe(true);
    expect(showToast.mock.calls.at(-1)?.[0]).toBe('Archived');
    await undo();

    store.items.n1 = { ...note, archived: true };
    await setArchived(store.items.n1, false);
    expect(showToast.mock.calls.at(-1)?.[0]).toBe('Restored');
    expect(showToast.mock.calls.at(-1)?.[1]?.label).toBe('Undo');
  });
});
