// @vitest-environment jsdom

import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the RS module to prevent RemoteStorage initialization side effects
const { mockFetchFileBlobUrl } = vi.hoisted(() => {
  const mockFetchFileBlobUrl = vi.fn();
  return { mockFetchFileBlobUrl };
});

const { mockRs, mockInbox } = vi.hoisted(() => {
  const mockInbox = {
    getAll: vi.fn().mockResolvedValue({}),
    getConfig: vi.fn().mockResolvedValue({}),
    getAllCollections: vi.fn().mockResolvedValue({}),
    getAllGroups: vi.fn().mockResolvedValue({}),
    onChange: vi.fn(),
    store: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    removeFile: vi.fn().mockResolvedValue(undefined),
    getFile: vi.fn().mockResolvedValue(undefined),
    storeCollection: vi.fn().mockResolvedValue(undefined),
    removeCollection: vi.fn().mockResolvedValue(undefined),
    storeGroup: vi.fn().mockResolvedValue(undefined),
    removeGroup: vi.fn().mockResolvedValue(undefined),
    setConfig: vi.fn().mockResolvedValue(undefined),
    getUserSettings: vi.fn().mockResolvedValue(undefined),
  };
  const mockRs = {
    access: { claim: vi.fn() },
    caching: { enable: vi.fn() },
    on: vi.fn(),
    remote: {},
    startSync: vi.fn(),
    inbox: mockInbox,
  };
  return { mockRs, mockInbox };
});

vi.mock('./rs', () => {
  return {
    default: mockRs,
    fetchFileBlobUrl: mockFetchFileBlobUrl,
    fetchFileWithAuth: vi.fn(),
  };
});

// Mock clean-for-storage
vi.mock('./clean-for-storage', () => ({
  cleanForStorage: (x: any) => x,
}));

import type {
  Collection,
  CollectionGroup,
  InboxItem,
} from '@inbox-rs/rs-module';
import {
  activeGroupIds,
  allTodos,
  appConfig,
  appConfigLoaded,
  blobUrls,
  collectionItems,
  collections,
  connected,
  createCollection,
  deleteCollection,
  deleteGroup,
  deleteItem,
  enableCollectionFilter,
  groupCollections,
  groups,
  inactiveCollectionIds,
  items,
  loadFileBlobUrl,
  moveCollectionToGroup,
  moveItemToCollection,
  openTodos,
  orphanCollections,
  pendingMigrationCount,
  removeItemFromCollection,
  reorderCollectionItems,
  reorderGroupCollections,
  reorderGroups,
  reorderTodosGlobal,
  reorderUnfiledTodos,
  setActiveGroupFilters,
  soloCollectionFilter,
  soloGroupFilter,
  storeCollection,
  storeGroup,
  storeItem,
  todoItems,
  toggleCollectionFilter,
  toggleGroupFilter,
  userSettings,
  visibleGroupedCollections,
  visibleOnCalendarTodos,
  visibleOpenTodos,
  visibleTodos,
} from './stores';

/**
 * rs.on() handlers are registered at module load time.
 * Capture them once before any test clears mocks.
 * Multiple handlers may be registered per event (e.g. sync-done has
 * hideSync, scheduleReload, and a debug logger).
 */
const rsHandlerMap: Record<string, Array<(...args: any[]) => any>> = {};
function captureRsHandlers() {
  if (Object.keys(rsHandlerMap).length > 0) return;
  for (const [event, handler] of mockRs.on.mock.calls as [
    string,
    (...args: any[]) => any,
  ][]) {
    rsHandlerMap[event] ??= [];
    rsHandlerMap[event].push(handler);
  }
}
captureRsHandlers();

/** Fire all registered handlers for an RS event */
function emitRsEvent(event: string, ...args: any[]) {
  for (const handler of rsHandlerMap[event] ?? []) {
    handler(...args);
  }
}

/** Capture the onChange handler registered at module load time (before mocks are cleared) */
const onChangeHandler = mockInbox.onChange.mock.calls[0]?.[0] as
  | ((event: any) => void)
  | undefined;

/** Simulate a remoteStorage module change event with per-item data */
function emitModuleChange(event: {
  relativePath: string;
  origin?: string;
  newValue?: any;
  oldValue?: any;
}) {
  if (onChangeHandler) onChangeHandler({ origin: 'remote', ...event });
}

/**
 * Item change events are batched (50ms window) before they hit the stores —
 * see the queueItemChange buffer in stores.ts. Await this after
 * emitModuleChange for `items/` paths to observe the applied state.
 */
async function flushItemChangeBatch() {
  await new Promise((resolve) => setTimeout(resolve, 60));
}

/** Backwards-compat: single-handler lookup for events with one handler (e.g. 'connected') */
const rsHandlers = new Proxy({} as Record<string, (...args: any[]) => any>, {
  get: (_target, prop: string) => {
    const handlers = rsHandlerMap[prop];
    return handlers?.[handlers.length - 1];
  },
});

describe('loadFileBlobUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blobUrls.set({});
    connected.set(true);
  });

  it('fetches file and stores blob URL in blobUrls store', async () => {
    mockFetchFileBlobUrl.mockResolvedValue('blob:test/123');

    loadFileBlobUrl('files/photo.jpg');

    // Wait for the async fetch to complete
    await vi.waitFor(() => {
      expect(get(blobUrls)['files/photo.jpg']).toBe('blob:test/123');
    });

    expect(mockFetchFileBlobUrl).toHaveBeenCalledWith(
      'files/photo.jpg',
      undefined,
    );
  });

  it('forwards mimeType through to fetchFileBlobUrl', async () => {
    // Callers (ImageCard, BookmarkCard, ViewCardModal) pass the item's
    // mimeType so the resulting blob gets a clean type instead of whatever
    // the server echoes back (5apps appends `; charset=binary`, which
    // Chrome refuses to render).
    mockFetchFileBlobUrl.mockResolvedValue('blob:test/typed');

    loadFileBlobUrl('files/photo.jpg', 'image/jpeg');

    await vi.waitFor(() => {
      expect(get(blobUrls)['files/photo.jpg']).toBe('blob:test/typed');
    });

    expect(mockFetchFileBlobUrl).toHaveBeenCalledWith(
      'files/photo.jpg',
      'image/jpeg',
    );
  });

  it('does not fetch if blob URL already exists', () => {
    blobUrls.set({ 'files/photo.jpg': 'blob:existing/456' });

    loadFileBlobUrl('files/photo.jpg');

    expect(mockFetchFileBlobUrl).not.toHaveBeenCalled();
  });

  it('reads from the local cache (not the network) when not connected', async () => {
    // Regression: a file captured while disconnected is persisted to the local
    // cache (alongside its metadata) and must still render after a reload,
    // without hitting the remote.
    connected.set(false);
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    mockInbox.getFile.mockResolvedValue({ data: bytes, mimeType: 'image/png' });
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:cache/photo');

    loadFileBlobUrl('files/photo.jpg', 'image/png');

    await vi.waitFor(() => {
      expect(get(blobUrls)['files/photo.jpg']).toBe('blob:cache/photo');
    });
    expect(mockFetchFileBlobUrl).not.toHaveBeenCalled();
    expect(mockInbox.getFile).toHaveBeenCalledWith('files/photo.jpg');

    createObjectURL.mockRestore();
  });

  it('stores no blob URL when the cache has no bytes while disconnected', async () => {
    connected.set(false);
    mockInbox.getFile.mockResolvedValue(undefined);

    loadFileBlobUrl('files/missing.jpg');

    await vi.waitFor(() => {
      expect(mockInbox.getFile).toHaveBeenCalledWith('files/missing.jpg');
    });
    expect(get(blobUrls)['files/missing.jpg']).toBeUndefined();
  });

  it('does not fetch for empty filePath', () => {
    loadFileBlobUrl('');

    expect(mockFetchFileBlobUrl).not.toHaveBeenCalled();
  });

  it('does not store blob URL when fetch returns null', async () => {
    mockFetchFileBlobUrl.mockResolvedValue(null);

    loadFileBlobUrl('files/missing.jpg');

    // Wait for the async fetch to complete
    await vi.waitFor(() => {
      expect(mockFetchFileBlobUrl).toHaveBeenCalled();
    });

    // Small delay to ensure the .then() callback has run
    await new Promise((r) => setTimeout(r, 10));
    expect(get(blobUrls)['files/missing.jpg']).toBeUndefined();
  });

  it('deduplicates concurrent requests for the same path', async () => {
    let resolveFirst!: (url: string) => void;
    mockFetchFileBlobUrl.mockReturnValue(
      new Promise<string>((r) => {
        resolveFirst = r;
      }),
    );

    loadFileBlobUrl('files/photo.jpg');
    loadFileBlobUrl('files/photo.jpg');
    loadFileBlobUrl('files/photo.jpg');

    // The loader checks the local cache first (async), so the network fetch
    // fires a microtask later — wait for it, then confirm it only fired once.
    await vi.waitFor(() => {
      expect(mockFetchFileBlobUrl).toHaveBeenCalled();
    });
    expect(mockFetchFileBlobUrl).toHaveBeenCalledTimes(1);

    resolveFirst('blob:test/deduped');
    await vi.waitFor(() => {
      expect(get(blobUrls)['files/photo.jpg']).toBe('blob:test/deduped');
    });
  });

  it('allows re-fetch after a failed attempt', async () => {
    mockFetchFileBlobUrl.mockResolvedValueOnce(null);

    loadFileBlobUrl('files/retry.jpg');

    // Wait for first attempt to complete
    await vi.waitFor(() => {
      expect(mockFetchFileBlobUrl).toHaveBeenCalledTimes(1);
    });
    await new Promise((r) => setTimeout(r, 10));

    // Second attempt should be allowed since first failed (no blob URL stored)
    mockFetchFileBlobUrl.mockResolvedValueOnce('blob:test/retry-ok');
    loadFileBlobUrl('files/retry.jpg');

    await vi.waitFor(() => {
      expect(get(blobUrls)['files/retry.jpg']).toBe('blob:test/retry-ok');
    });

    expect(mockFetchFileBlobUrl).toHaveBeenCalledTimes(2);
  });

  it('handles multiple different files independently', async () => {
    mockFetchFileBlobUrl
      .mockResolvedValueOnce('blob:test/a')
      .mockResolvedValueOnce('blob:test/b');

    loadFileBlobUrl('files/a.jpg');
    loadFileBlobUrl('files/b.png');

    await vi.waitFor(() => {
      const urls = get(blobUrls);
      expect(urls['files/a.jpg']).toBe('blob:test/a');
      expect(urls['files/b.png']).toBe('blob:test/b');
    });

    expect(mockFetchFileBlobUrl).toHaveBeenCalledTimes(2);
  });
});

describe('blob URL cleanup (memory leak prevention)', () => {
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    blobUrls.set({});
    connected.set(true);
    // Spy on revoke so we can assert cleanup behavior.
    // Do NOT call vi.clearAllMocks() here — it would wipe the captured
    // rs.on() calls that other tests (and emitRsEvent) rely on.
    revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    revokeSpy?.mockRestore();
    blobUrls.set({});
  });

  it('revokes and removes blob URL when deleteItem is called with a file-backed item', async () => {
    blobUrls.set({ 'files/photo.jpg': 'blob:mem/abc123' });

    const fileItem: InboxItem = {
      id: 'note-with-photo',
      type: 'note',
      title: 'test',
      body: '',
      createdAt: new Date().toISOString(),
      filePath: 'files/photo.jpg',
    } as any;

    await deleteItem('note-with-photo', fileItem);

    expect(revokeSpy).toHaveBeenCalledWith('blob:mem/abc123');
    expect(get(blobUrls)['files/photo.jpg']).toBeUndefined();
  });

  it('revokes all blob URLs on disconnect (via captured handler)', () => {
    blobUrls.set({
      'files/a.jpg': 'blob:mem/a',
      'files/b.mp3': 'blob:mem/b',
    });

    // Use the test helper that fires all captured handlers for the event.
    // This avoids mutating mock state.
    emitRsEvent('disconnected');

    expect(revokeSpy).toHaveBeenCalledWith('blob:mem/a');
    expect(revokeSpy).toHaveBeenCalledWith('blob:mem/b');
    expect(get(blobUrls)).toEqual({});
  });

  it('does not throw when revoking during disconnect with no blobs', () => {
    blobUrls.set({});

    expect(() => emitRsEvent('disconnected')).not.toThrow();
    expect(get(blobUrls)).toEqual({});
  });
});

// ---- Helpers for collection/group tests ----

function makeCollection(id: string, groupId?: string): Collection {
  return {
    id,
    name: `Collection ${id}`,
    itemIds: [],
    createdAt: new Date().toISOString(),
    ...(groupId ? { groupId } : {}),
  };
}

function makeGroup(id: string, collectionIds: string[] = []): CollectionGroup {
  return {
    id,
    name: `Group ${id}`,
    collectionIds,
    createdAt: new Date().toISOString(),
  };
}

function makeTodo(id: string, overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id,
    type: 'todo',
    title: `Todo ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as InboxItem;
}

function makeLegacyVoiceMemo(id: string): InboxItem {
  return {
    id,
    type: 'voice-memo',
    title: `Voice memo ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    filePath: `files/${id}.m4a`,
    mimeType: 'audio/mp4',
  } as unknown as InboxItem;
}

function makeVersionedNote(id: string, version: number): InboxItem {
  return {
    id,
    type: 'note',
    title: `Note ${id}`,
    body: `Body ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    _migrateVersion: version,
  } as InboxItem;
}

describe('groupCollections', () => {
  beforeEach(() => {
    collections.set({});
    groups.set({});
  });

  it('shows collections listed in group.collectionIds', () => {
    const col1 = makeCollection('c1', 'g1');
    const col2 = makeCollection('c2', 'g1');
    const group = makeGroup('g1', ['c1', 'c2']);

    collections.set({ c1: col1, c2: col2 });
    groups.set({ g1: group });

    const result = get(groupCollections);
    expect(result.g1).toHaveLength(2);
    expect(result.g1[0].id).toBe('c1');
    expect(result.g1[1].id).toBe('c2');
  });

  it('shows collections with groupId but missing from collectionIds', () => {
    const col1 = makeCollection('c1', 'g1');
    const col2 = makeCollection('c2', 'g1');
    // Group only knows about c1, but c2 also has groupId pointing here
    const group = makeGroup('g1', ['c1']);

    collections.set({ c1: col1, c2: col2 });
    groups.set({ g1: group });

    const result = get(groupCollections);
    expect(result.g1).toHaveLength(2);
    expect(result.g1[0].id).toBe('c1');
    expect(result.g1[1].id).toBe('c2');
  });

  it('preserves collectionIds order and appends orphans after', () => {
    const col1 = makeCollection('c1', 'g1');
    const col2 = makeCollection('c2', 'g1');
    const col3 = makeCollection('c3', 'g1');
    // Group has c2 then c1 in order; c3 is orphaned
    const group = makeGroup('g1', ['c2', 'c1']);

    collections.set({ c1: col1, c2: col2, c3: col3 });
    groups.set({ g1: group });

    const result = get(groupCollections);
    expect(result.g1.map((c) => c.id)).toEqual(['c2', 'c1', 'c3']);
  });

  it('filters out stale collectionIds entries', () => {
    const col1 = makeCollection('c1', 'g1');
    // Group references c1 and c_deleted, but c_deleted doesn't exist
    const group = makeGroup('g1', ['c1', 'c_deleted']);

    collections.set({ c1: col1 });
    groups.set({ g1: group });

    const result = get(groupCollections);
    expect(result.g1).toHaveLength(1);
    expect(result.g1[0].id).toBe('c1');
  });

  it('does not show collection in stale group after move', () => {
    // Partial write: collection moved to g2 but g1.collectionIds still references it
    const col1 = makeCollection('c1', 'g2');
    const oldGroup = makeGroup('g1', ['c1']);
    const newGroup = makeGroup('g2', []);

    collections.set({ c1: col1 });
    groups.set({ g1: oldGroup, g2: newGroup });

    const result = get(groupCollections);
    // c1 should only appear in g2 (its actual groupId), not g1
    expect(result.g1).toHaveLength(0);
    expect(result.g2).toHaveLength(1);
    expect(result.g2[0].id).toBe('c1');
  });

  it('returns empty array for group with no collections', () => {
    const group = makeGroup('g1', []);
    groups.set({ g1: group });

    const result = get(groupCollections);
    expect(result.g1).toEqual([]);
  });
});

describe('todoItems ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items.set({});
    appConfig.set({});
  });

  it('stores a new todo while disconnected without groups or collections as unfiled', async () => {
    connected.set(false);
    collections.set({});
    groups.set({});
    const todo = makeTodo('quick', {
      title: 'Quick thought',
      completed: false,
      isTodo: true,
    });

    await storeItem(todo);

    expect(mockInbox.store).toHaveBeenCalledWith(todo, undefined, undefined);
    expect(get(items).quick).toMatchObject({
      id: 'quick',
      title: 'Quick thought',
      type: 'todo',
      completed: false,
      isTodo: true,
    });
    expect(get(items).quick.collectionId).toBeUndefined();
    expect(get(todoItems).map((t) => t.id)).toEqual(['quick']);
  });

  it('keeps configured open todo order and falls back to newest-first for new todos', () => {
    items.set({
      t1: makeTodo('t1', { createdAt: '2026-01-01T00:00:00.000Z' }),
      t2: makeTodo('t2', { createdAt: '2026-01-02T00:00:00.000Z' }),
      t3: makeTodo('t3', { createdAt: '2026-01-03T00:00:00.000Z' }),
    });
    appConfig.set({ todosGlobalOrder: ['t2'] });

    expect(get(todoItems).map((todo) => todo.id)).toEqual(['t2', 't3', 't1']);
  });

  it('keeps completed todos after open todos and sorts them by completion time', () => {
    items.set({
      open: makeTodo('open', { createdAt: '2026-01-01T00:00:00.000Z' }),
      'done-older': makeTodo('done-older', {
        createdAt: '2026-01-02T00:00:00.000Z',
        completed: true,
        completedAt: '2026-01-04T00:00:00.000Z',
      }),
      'done-newer': makeTodo('done-newer', {
        createdAt: '2026-01-03T00:00:00.000Z',
        completed: true,
        completedAt: '2026-01-05T00:00:00.000Z',
      }),
    });

    expect(get(todoItems).map((todo) => todo.id)).toEqual([
      'open',
      'done-newer',
      'done-older',
    ]);
  });

  it('persists reordered unfiled todo ids into todosGlobalOrder', async () => {
    appConfig.set({});
    items.set({
      t1: makeTodo('t1'),
      t2: makeTodo('t2'),
      t3: makeTodo('t3'),
    });

    await reorderUnfiledTodos(['t3', 't1', 't2']);

    expect(get(appConfig).todosGlobalOrder).toEqual(['t3', 't1', 't2']);
    expect(mockInbox.setConfig).toHaveBeenCalledWith({
      todosGlobalOrder: ['t3', 't1', 't2'],
    });
  });

  it('splices unfiled reorders into todosGlobalOrder without moving filed todos', async () => {
    // Two filed todos (c1, c2) flanking three unfiled (u1, u2, u3).
    // Reordering the unfiled subset must preserve c1/c2's global
    // positions — the flat /todos page relies on that to not scramble the
    // order of todos it doesn't see.
    items.set({
      c1: makeTodo('c1', { collectionId: 'col-a' }),
      c2: makeTodo('c2', { collectionId: 'col-b' }),
      u1: makeTodo('u1'),
      u2: makeTodo('u2'),
      u3: makeTodo('u3'),
    });
    appConfig.set({ todosGlobalOrder: ['u1', 'c1', 'u2', 'c2', 'u3'] });

    await reorderUnfiledTodos(['u3', 'u1', 'u2']);

    // u1/u2/u3 occupy the same global slots they did before; only their
    // relative order has changed. c1 and c2 stay exactly where they were.
    expect(get(appConfig).todosGlobalOrder).toEqual([
      'u3',
      'c1',
      'u1',
      'c2',
      'u2',
    ]);
  });
});

describe('collection todo consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
    mockInbox.getAll.mockResolvedValue({});
    mockInbox.getConfig.mockResolvedValue({});
    mockInbox.getAllCollections.mockResolvedValue({});
    mockInbox.getAllGroups.mockResolvedValue({});
    mockInbox.getUserSettings.mockResolvedValue(undefined);
  });

  it('marks config loaded only after the saved collection filters are hydrated', async () => {
    appConfigLoaded.set(false);
    mockInbox.getConfig.mockResolvedValue({
      activeGroupFilters: ['g1'],
      inactiveCollectionFilters: ['c2'],
    });

    const connectedLoad = rsHandlers.connected();

    expect(get(appConfigLoaded)).toBe(false);
    await connectedLoad;
    expect(get(appConfigLoaded)).toBe(true);
    expect(get(appConfig)).toEqual({
      activeGroupFilters: ['g1'],
      inactiveCollectionFilters: ['c2'],
    });
  });

  it('ignores item records whose storage key does not match the item id', async () => {
    const canonical = makeTodo('t1', { collectionId: 'c1' });
    const stale = makeTodo('t1');
    mockInbox.getAll.mockResolvedValue({
      stale_copy: stale,
      t1: canonical,
    });

    await rsHandlers.connected();

    expect(get(items)).toEqual({ t1: canonical });
    expect(get(todoItems)).toEqual([]);
  });

  it('does not surface stale collection refs when an item is not actually in that collection', () => {
    const inboxTodo = makeTodo('t1');
    const collection = {
      ...makeCollection('c1'),
      itemIds: ['t1'],
    };

    items.set({ t1: inboxTodo });
    collections.set({ c1: collection });

    expect(get(collectionItems).c1).toEqual([]);
    expect(get(todoItems).map((todo) => todo.id)).toEqual(['t1']);
  });
});

describe('moveItemToCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('scrubs the source collection itemIds when moving between collections', async () => {
    // Regression: `convertToTodoInCollection` used to call `storeItem` with
    // the new collectionId BEFORE `moveItemToCollection`, which made the
    // helper see the target as the source and skip scrubbing. Callers should
    // always route the collection change through `moveItemToCollection` while
    // the store still has the old collectionId.
    const item = makeTodo('t1', { collectionId: 'source' });
    const source = { ...makeCollection('source'), itemIds: ['t1'] };
    const target = { ...makeCollection('target'), itemIds: [] };

    items.set({ t1: item });
    collections.set({ source, target: target });

    await moveItemToCollection('t1', 'target');

    expect(get(collections).source.itemIds).toEqual([]);
    expect(get(collections).target.itemIds).toEqual(['t1']);
    expect(get(items).t1.collectionId).toBe('target');
  });

  it('adds to the target collection itemIds when moving from unfiled', async () => {
    const item = makeTodo('t1'); // no collectionId
    const target = { ...makeCollection('target'), itemIds: [] };

    items.set({ t1: item });
    collections.set({ target: target });

    await moveItemToCollection('t1', 'target');

    expect(get(collections).target.itemIds).toEqual(['t1']);
    expect(get(items).t1.collectionId).toBe('target');
  });
});

describe('deleteGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('refuses to delete a group when collections reference it via groupId (even if collectionIds is empty)', async () => {
    const col = makeCollection('c1', 'g1');
    const group = makeGroup('g1', []); // collectionIds is empty but col has groupId

    collections.set({ c1: col });
    groups.set({ g1: group });

    const result = await deleteGroup('g1');

    expect(result).toBe(false);
    expect(get(groups).g1).toBeDefined();
  });

  it('refuses to delete a group when collectionIds and groupId both reference it', async () => {
    const col = makeCollection('c1', 'g1');
    const group = makeGroup('g1', ['c1']);

    collections.set({ c1: col });
    groups.set({ g1: group });

    const result = await deleteGroup('g1');

    expect(result).toBe(false);
    expect(get(groups).g1).toBeDefined();
  });

  it('allows deleting a group with no collections referencing it', async () => {
    const group = makeGroup('g1', []);

    groups.set({ g1: group });

    const result = await deleteGroup('g1');

    expect(result).toBe(true);
    expect(get(groups).g1).toBeUndefined();
  });

  it('allows deleting a group where collectionIds has stale entries but no collection has matching groupId', async () => {
    // collectionIds references c_deleted which doesn't exist, and c1 has groupId pointing elsewhere
    const col = makeCollection('c1', 'g2');
    const group = makeGroup('g1', ['c_deleted']);

    collections.set({ c1: col });
    groups.set({ g1: group, g2: makeGroup('g2', ['c1']) });

    const result = await deleteGroup('g1');

    expect(result).toBe(true);
    expect(get(groups).g1).toBeUndefined();
  });

  it('drops the deleted id from the filter allow-list', async () => {
    groups.set({ g1: makeGroup('g1', []), g2: makeGroup('g2', []) });
    appConfig.set({ activeGroupFilters: ['g1', 'g2'] });

    await deleteGroup('g1');

    expect(get(appConfig).activeGroupFilters).toEqual(['g2']);
  });

  it('resets filters to all-active rather than empty when the last id goes', async () => {
    groups.set({ g1: makeGroup('g1', []), g2: makeGroup('g2', []) });
    // Only g1 was visible; deleting it must not leave [] ("show nothing").
    appConfig.set({ activeGroupFilters: ['g1'] });

    await deleteGroup('g1');

    expect(get(appConfig).activeGroupFilters).toBeUndefined();
    expect(get(activeGroupIds)).toEqual(new Set(['g2']));
  });
});

describe('pendingMigrationCount visibility timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Trigger the disconnected handler so private stores (rawItems used by
    // pendingMigrationCount) are reset alongside the public ones — loadItems
    // now merges into rawItems instead of replacing, so leftover entries
    // from prior tests in this file would otherwise leak in here.
    rsHandlers.disconnected?.();
    connected.set(false);
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
    mockInbox.getAll.mockResolvedValue({});
    mockInbox.getConfig.mockResolvedValue({});
    mockInbox.getAllCollections.mockResolvedValue({});
    mockInbox.getAllGroups.mockResolvedValue({});
    mockInbox.getUserSettings.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps migration count hidden until initial sync settles', async () => {
    mockInbox.getAll.mockResolvedValue({
      legacy: makeLegacyVoiceMemo('legacy'),
    });

    await rsHandlers.connected();

    expect(get(pendingMigrationCount)).toBe(0);

    emitRsEvent('sync-done');

    expect(get(pendingMigrationCount)).toBe(1);
  });

  it('shows migration count after the fallback timeout when no sync signal arrives', async () => {
    mockInbox.getAll.mockResolvedValue({
      legacy: makeLegacyVoiceMemo('legacy'),
    });

    await rsHandlers.connected();

    expect(get(pendingMigrationCount)).toBe(0);

    await vi.advanceTimersByTimeAsync(2500);

    expect(get(pendingMigrationCount)).toBe(1);
  });

  it('does not count docs that only need a version bump with no content change', async () => {
    mockInbox.getAll.mockResolvedValue({
      note1: makeVersionedNote('note1', 1),
    });

    await rsHandlers.connected();
    emitRsEvent('sync-done');

    expect(get(pendingMigrationCount)).toBe(0);
  });
});

describe('no group recreation after deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
    appConfig.set({});
    mockInbox.getAll.mockResolvedValue({});
    mockInbox.getConfig.mockResolvedValue({});
    mockInbox.getAllCollections.mockResolvedValue({});
    mockInbox.getAllGroups.mockResolvedValue({});
    mockInbox.getUserSettings.mockResolvedValue(undefined);
  });

  it('does not recreate a group after deletion when unrelated changes arrive', async () => {
    const group = makeGroup('g1', []);
    groups.set({ g1: group });

    await deleteGroup('g1');
    expect(get(groups).g1).toBeUndefined();

    // An unrelated item change should not recreate the deleted group
    emitModuleChange({
      relativePath: 'items/i1',
      newValue: {
        id: 'i1',
        type: 'note',
        title: 'X',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(Object.keys(get(groups))).toHaveLength(0);
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
  });
});

describe('per-item change handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('adds an incoming item to the store', async () => {
    const item = {
      id: 'i1',
      type: 'note',
      title: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    emitModuleChange({ relativePath: 'items/i1', newValue: item });
    await flushItemChangeBatch();

    expect(get(items).i1).toBeDefined();
    expect(get(items).i1.title).toBe('Test');
  });

  it('removes a deleted item from the store', async () => {
    items.set({
      i1: {
        id: 'i1',
        type: 'note',
        title: 'Old',
        createdAt: '2026-01-01T00:00:00.000Z',
      } as InboxItem,
    });

    emitModuleChange({
      relativePath: 'items/i1',
      newValue: undefined,
      oldValue: { id: 'i1' },
    });
    await flushItemChangeBatch();

    expect(get(items).i1).toBeUndefined();
  });

  it('adds an incoming collection with itemIds normalization', () => {
    const col = {
      id: 'c1',
      name: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    emitModuleChange({ relativePath: 'collections/c1', newValue: col });

    expect(get(collections).c1).toBeDefined();
    expect(get(collections).c1.itemIds).toEqual([]);
  });

  it('adds an incoming group with collectionIds normalization', () => {
    const grp = {
      id: 'g1',
      name: 'Test Group',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    emitModuleChange({ relativePath: 'groups/g1', newValue: grp });

    expect(get(groups).g1).toBeDefined();
    expect(get(groups).g1.collectionIds).toEqual([]);
  });

  it('updates appConfig on config/app change', () => {
    emitModuleChange({
      relativePath: 'config/app',
      newValue: { todosGlobalOrder: ['t1', 't2'] },
    });

    expect(get(appConfig).todosGlobalOrder).toEqual(['t1', 't2']);
  });

  it('updates userSettings on config/user change', () => {
    emitModuleChange({
      relativePath: 'config/user',
      newValue: { theme: 'dark' },
    });

    expect((get(userSettings) as any).theme).toBe('dark');
  });

  it('ignores window-origin events (local writes already update stores)', () => {
    emitModuleChange({
      relativePath: 'items/i1',
      origin: 'window',
      newValue: { id: 'i1', type: 'note', title: 'X', createdAt: '' },
    });

    expect(get(items).i1).toBeUndefined();
  });

  it('handles multiple incoming items without calling getAll', async () => {
    for (let i = 0; i < 5; i++) {
      emitModuleChange({
        relativePath: `items/i${i}`,
        newValue: {
          id: `i${i}`,
          type: 'note',
          title: `Note ${i}`,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      });
    }
    await flushItemChangeBatch();

    expect(Object.keys(get(items))).toHaveLength(5);
    expect(mockInbox.getAll).not.toHaveBeenCalled();
  });

  it('removes a deleted collection from the store', () => {
    collections.set({ c1: makeCollection('c1') });

    emitModuleChange({
      relativePath: 'collections/c1',
      newValue: undefined,
      oldValue: { id: 'c1' },
    });

    expect(get(collections).c1).toBeUndefined();
  });

  it('removes a deleted group from the store', () => {
    groups.set({ g1: makeGroup('g1') });

    emitModuleChange({
      relativePath: 'groups/g1',
      newValue: undefined,
      oldValue: { id: 'g1' },
    });

    expect(get(groups).g1).toBeUndefined();
  });
});

describe('deleteGroup preserves collections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('does not delete collections when deleting an empty group', async () => {
    const col = makeCollection('c1', 'g2');
    const group1 = makeGroup('g1', []);
    const group2 = makeGroup('g2', ['c1']);

    collections.set({ c1: col });
    groups.set({ g1: group1, g2: group2 });

    await deleteGroup('g1');

    // g1 is gone, g2 and c1 are untouched
    expect(get(groups).g1).toBeUndefined();
    expect(get(groups).g2).toBeDefined();
    expect(get(collections).c1).toBeDefined();
    expect(get(collections).c1.groupId).toBe('g2');
  });

  it('does not modify any collection groupId when deleting a group', async () => {
    const col1 = makeCollection('c1', 'g2');
    const col2 = makeCollection('c2');
    const emptyGroup = makeGroup('g1', []);
    const otherGroup = makeGroup('g2', ['c1']);

    collections.set({ c1: col1, c2: col2 });
    groups.set({ g1: emptyGroup, g2: otherGroup });

    await deleteGroup('g1');

    // All collection groupIds unchanged
    expect(get(collections).c1.groupId).toBe('g2');
    expect(get(collections).c2.groupId).toBeUndefined();
    expect(mockInbox.storeCollection).not.toHaveBeenCalled();
  });
});

describe('deleteGroup with non-existent group', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('returns false and skips backend call for non-existent group', async () => {
    groups.set({ g1: makeGroup('g1', []) });

    const result = await deleteGroup('g_nonexistent');

    expect(result).toBe(false);
    expect(get(groups).g1).toBeDefined();
    expect(mockInbox.removeGroup).not.toHaveBeenCalled();
  });
});

// ---- Direct storeCollection writes leave groupId untouched ----
// `storeCollection` is the low-level write. It does not repair legacy
// collection group membership; the app-load repair path handles that once
// collections and groups have both been loaded.

describe('storeCollection: raw groupId handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('preserves an undefined groupId without creating a group', async () => {
    const col = makeCollection('c1');

    await storeCollection(col);

    expect(get(collections).c1).toBeDefined();
    expect(get(collections).c1.groupId).toBeUndefined();
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
  });

  it('preserves an empty-string groupId without creating a group', async () => {
    const col: Collection = {
      id: 'c1',
      name: 'Test',
      itemIds: [],
      createdAt: new Date().toISOString(),
      groupId: '',
    };

    await storeCollection(col);

    expect(get(collections).c1.groupId).toBe('');
  });
});

describe('reorderGroupCollections with invalid group ids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('reorderGroupCollections with empty groupId does not modify any group', async () => {
    const group = makeGroup('g1', ['c1', 'c2']);
    const col1 = makeCollection('c1', 'g1');
    const col2 = makeCollection('c2', 'g1');

    collections.set({ c1: col1, c2: col2 });
    groups.set({ g1: group });

    await reorderGroupCollections('', ['c2', 'c1']);

    // g1 should be untouched
    expect(get(groups).g1.collectionIds).toEqual(['c1', 'c2']);
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
  });

  it('reorderGroupCollections with valid groupId works normally', async () => {
    const group = makeGroup('g1', ['c1', 'c2']);
    const col1 = makeCollection('c1', 'g1');
    const col2 = makeCollection('c2', 'g1');

    collections.set({ c1: col1, c2: col2 });
    groups.set({ g1: group });

    await reorderGroupCollections('g1', ['c2', 'c1']);

    expect(get(groups).g1.collectionIds).toEqual(['c2', 'c1']);
    expect(mockInbox.storeGroup).toHaveBeenCalled();
  });
});

describe('activeGroupIds', () => {
  beforeEach(() => {
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('returns all group ids when activeGroupFilters is undefined', () => {
    groups.set({
      g1: makeGroup('g1'),
      g2: makeGroup('g2'),
    });
    const ids = get(activeGroupIds);
    expect(ids.has('g1')).toBe(true);
    expect(ids.has('g2')).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('returns empty set when activeGroupFilters is empty array', () => {
    groups.set({ g1: makeGroup('g1') });
    appConfig.set({ activeGroupFilters: [] });
    expect(get(activeGroupIds).size).toBe(0);
  });

  it('returns only listed ids when activeGroupFilters is set', () => {
    groups.set({
      g1: makeGroup('g1'),
      g2: makeGroup('g2'),
      g3: makeGroup('g3'),
    });
    appConfig.set({ activeGroupFilters: ['g1', 'g3'] });
    const ids = get(activeGroupIds);
    expect(ids.has('g1')).toBe(true);
    expect(ids.has('g2')).toBe(false);
    expect(ids.has('g3')).toBe(true);
  });

  it('drops ids that no longer correspond to real groups', () => {
    groups.set({ g1: makeGroup('g1') });
    appConfig.set({ activeGroupFilters: ['g1', 'g_deleted'] });
    const ids = get(activeGroupIds);
    expect(ids.has('g1')).toBe(true);
    expect(ids.has('g_deleted')).toBe(false);
  });
});

describe('visibleGroupedCollections', () => {
  beforeEach(() => {
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('returns all groups by default preserving the configured collection order', () => {
    const c1 = makeCollection('c1', 'g1');
    const c2 = makeCollection('c2', 'g1');
    collections.set({ c1, c2 });
    groups.set({ g1: makeGroup('g1', ['c2', 'c1']) });

    const sections = get(visibleGroupedCollections);
    expect(sections).toHaveLength(1);
    expect(sections[0].group.id).toBe('g1');
    expect(sections[0].collections.map((c) => c.id)).toEqual(['c2', 'c1']);
  });

  it('omits groups that are filtered out', () => {
    collections.set({});
    groups.set({
      g1: makeGroup('g1', []),
      g2: makeGroup('g2', []),
    });
    appConfig.set({ activeGroupFilters: ['g2'] });

    const sections = get(visibleGroupedCollections);
    expect(sections.map((s) => s.group.id)).toEqual(['g2']);
  });

  it('returns empty when all groups are filtered out', () => {
    groups.set({ g1: makeGroup('g1', []) });
    appConfig.set({ activeGroupFilters: [] });
    expect(get(visibleGroupedCollections)).toHaveLength(0);
  });

  it('hides individual collections switched off via the sidebar', () => {
    const c1 = makeCollection('c1', 'g1');
    const c2 = makeCollection('c2', 'g1');
    collections.set({ c1, c2 });
    groups.set({ g1: makeGroup('g1', ['c1', 'c2']) });
    appConfig.set({ inactiveCollectionFilters: ['c1'] });

    const sections = get(visibleGroupedCollections);
    expect(sections).toHaveLength(1);
    expect(sections[0].collections.map((c) => c.id)).toEqual(['c2']);
  });
});

describe('collection filter (sidebar)', () => {
  beforeEach(() => {
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
    vi.clearAllMocks();
    mockInbox.setConfig.mockResolvedValue(undefined);
  });

  it('inactiveCollectionIds reflects the configured deny-list', () => {
    appConfig.set({ inactiveCollectionFilters: ['c1', 'c2'] });
    const ids = get(inactiveCollectionIds);
    expect(ids.has('c1')).toBe(true);
    expect(ids.has('c2')).toBe(true);
    expect(ids.has('c3')).toBe(false);
  });

  it('is empty when no collections are switched off', () => {
    appConfig.set({});
    expect(get(inactiveCollectionIds).size).toBe(0);
  });

  it('toggleCollectionFilter adds then removes an id', async () => {
    appConfig.set({});
    await toggleCollectionFilter('c1');
    expect(get(appConfig).inactiveCollectionFilters).toEqual(['c1']);

    await toggleCollectionFilter('c1');
    expect(get(appConfig).inactiveCollectionFilters).toEqual([]);
  });
});

describe('orphanCollections', () => {
  beforeEach(() => {
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('is empty when every collection has a real group', () => {
    collections.set({
      c1: makeCollection('c1', 'g1'),
      c2: makeCollection('c2', 'g1'),
    });
    groups.set({ g1: makeGroup('g1', ['c1', 'c2']) });

    expect(get(orphanCollections)).toEqual([]);
  });

  it('surfaces collections with no groupId', () => {
    const c1 = makeCollection('c1');
    delete (c1 as any).groupId;
    collections.set({ c1 });

    expect(get(orphanCollections).map((c) => c.id)).toEqual(['c1']);
  });

  it('surfaces collections whose groupId points at a deleted group', () => {
    collections.set({
      c1: makeCollection('c1', 'g1'),
      stale: makeCollection('stale', 'g_deleted'),
    });
    groups.set({ g1: makeGroup('g1', ['c1']) });

    expect(get(orphanCollections).map((c) => c.id)).toEqual(['stale']);
  });

  it('orders orphans by createdAt for a stable display order', () => {
    const newer = makeCollection('newer');
    const older = makeCollection('older');
    delete (newer as any).groupId;
    delete (older as any).groupId;
    newer.createdAt = '2026-03-01T00:00:00.000Z';
    older.createdAt = '2026-01-01T00:00:00.000Z';
    collections.set({ newer, older });

    expect(get(orphanCollections).map((c) => c.id)).toEqual(['older', 'newer']);
  });
});

// ---- Offline-create-then-login flow ----
//
// Bug report: a user offline-creates a group + a collection inside it.
// On login, the collection appears as an orphan ("Needs a group") even
// though both records still exist. These tests simulate the post-login
// data-loading and change-event sequence to verify groupId survives.

describe('offline-create-then-login: group association is preserved', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
    mockInbox.getAll.mockResolvedValue({});
    mockInbox.getConfig.mockResolvedValue({});
    mockInbox.getAllCollections.mockResolvedValue({});
    mockInbox.getAllGroups.mockResolvedValue({});
    mockInbox.getUserSettings.mockResolvedValue(undefined);
  });

  it('keeps groupId after the connected handler loads from IDB', async () => {
    // Cache state we'd see after offline create+move: collection has
    // groupId pointing at the local group, and the group's collectionIds
    // lists the collection.
    mockInbox.getAllCollections.mockResolvedValue({
      c1: makeCollection('c1', 'g1'),
    });
    mockInbox.getAllGroups.mockResolvedValue({
      g1: makeGroup('g1', ['c1']),
    });

    await rsHandlers.connected();

    expect(get(collections).c1.groupId).toBe('g1');
    expect(get(groups).g1.collectionIds).toEqual(['c1']);
    expect(get(orphanCollections)).toEqual([]);
  });

  it('keeps groupId when fireInitial replays cached docs as local events', async () => {
    // After connect, RS replays every cached document as an `origin: local`
    // change event (see remoteStorage.fireInitial). The handler must merge
    // these in without dropping the groupId off the in-memory record.
    mockInbox.getAllCollections.mockResolvedValue({
      c1: makeCollection('c1', 'g1'),
    });
    mockInbox.getAllGroups.mockResolvedValue({
      g1: makeGroup('g1', ['c1']),
    });

    await rsHandlers.connected();

    // Now simulate the fireInitial replay — emits a 'local' event for every
    // cached document. Both group and collection are replayed.
    emitModuleChange({
      relativePath: 'groups/g1',
      origin: 'local',
      newValue: makeGroup('g1', ['c1']),
      oldValue: undefined,
    });
    emitModuleChange({
      relativePath: 'collections/c1',
      origin: 'local',
      newValue: makeCollection('c1', 'g1'),
      oldValue: undefined,
    });

    expect(get(orphanCollections)).toEqual([]);
    expect(get(collections).c1.groupId).toBe('g1');
  });

  it('survives collection-before-group event ordering during fireInitial', async () => {
    // RS iterates the cached node tree in `forAllNodes`. The order isn't
    // alphabetical — a collection event can arrive before its parent group
    // event. The store handlers must not drop groupId based on the (still
    // empty) groups store at the moment the collection event arrives.
    mockInbox.getAllCollections.mockResolvedValue({});
    mockInbox.getAllGroups.mockResolvedValue({});

    await rsHandlers.connected();

    // Collection arrives first, before the group is in the store.
    emitModuleChange({
      relativePath: 'collections/c1',
      origin: 'local',
      newValue: makeCollection('c1', 'g1'),
      oldValue: undefined,
    });
    // Group arrives second.
    emitModuleChange({
      relativePath: 'groups/g1',
      origin: 'local',
      newValue: makeGroup('g1', ['c1']),
      oldValue: undefined,
    });

    expect(get(collections).c1.groupId).toBe('g1');
    expect(get(orphanCollections)).toEqual([]);
  });

  it('does not drop groupId when getAll merges into a partially-populated store', async () => {
    // Simulate the in-flight race: the change handler put c1 into the
    // store via fireInitial *before* loadCollections resolved. Then
    // loadEntities merges its getAll result on top — and must not strip
    // groupId.
    collections.set({ c1: makeCollection('c1', 'g1') });

    mockInbox.getAllCollections.mockResolvedValue({
      c1: makeCollection('c1', 'g1'),
    });
    mockInbox.getAllGroups.mockResolvedValue({
      g1: makeGroup('g1', ['c1']),
    });

    await rsHandlers.connected();

    expect(get(collections).c1.groupId).toBe('g1');
    expect(get(orphanCollections)).toEqual([]);
  });

  it('does not drop groupId when sync emits a remote event with the same body', async () => {
    // After PUT completes for a fresh sync, RS does NOT emit a change for
    // the document — completePush updates node.common.body silently. But
    // some related codepaths (folder GET on first connect) can emit
    // 'remote' events with the merged body. Verify the handler preserves
    // groupId even on a 'remote' replay.
    mockInbox.getAllCollections.mockResolvedValue({
      c1: makeCollection('c1', 'g1'),
    });
    mockInbox.getAllGroups.mockResolvedValue({
      g1: makeGroup('g1', ['c1']),
    });

    await rsHandlers.connected();

    emitModuleChange({
      relativePath: 'collections/c1',
      origin: 'remote',
      newValue: makeCollection('c1', 'g1'),
      oldValue: undefined,
    });

    expect(get(collections).c1.groupId).toBe('g1');
    expect(get(orphanCollections)).toEqual([]);
  });

  it('does not orphan when getAllCollections returns a folder-listing fallback', async () => {
    // remotestoragejs's getAll('collections/', false) returns the folder
    // listing first, then fans out per-document GETs. If the per-document
    // fetches haven't filled in the bodies yet, getAll can return
    // `{ c1: true }` (the folder itemsMap with placeholder values).
    // loadEntities filters non-objects out, so the store stays unchanged
    // for c1 — and any earlier insert (e.g. via change events) is
    // preserved.
    collections.set({ c1: makeCollection('c1', 'g1') });
    groups.set({ g1: makeGroup('g1', ['c1']) });

    mockInbox.getAllCollections.mockResolvedValue({
      c1: true as unknown as Collection,
    });
    mockInbox.getAllGroups.mockResolvedValue({
      g1: true as unknown as CollectionGroup,
    });

    await rsHandlers.connected();

    expect(get(collections).c1.groupId).toBe('g1');
    expect(get(orphanCollections)).toEqual([]);
  });

  it('keeps the offline-created collection visible when synced appConfig has only stale filter ids', async () => {
    // The actual orphaning bug as observed in user data:
    //   - The offline cache (or the synced server appConfig) has
    //     `activeGroupFilters` containing only ids of long-deleted groups.
    //   - The user offline-creates a fresh group `Zg` and a collection `Zc`
    //     in it; `storeGroup` only appends to `activeGroupFilters` when the
    //     filter is already defined — and even when it does, sync may
    //     replace local config with the server's older copy.
    //   - After login, `activeGroupIds` would historically return `∅`, and
    //     `visibleGroupedCollections` would hide `Zg`/`Zc` entirely.
    // Verify that with the stale-filter fallback, every real group becomes
    // active again so the offline-created data is visible.
    groups.set({
      A: makeGroup('A'),
      Zg: makeGroup('Zg', ['Zc']),
    });
    collections.set({
      Zc: makeCollection('Zc', 'Zg'),
    });
    appConfig.set({ activeGroupFilters: ['stale-deleted-group-id'] });

    expect(get(activeGroupIds)).toEqual(new Set(['A', 'Zg']));
    expect(get(visibleGroupedCollections).map((s) => s.group.id)).toEqual([
      'A',
      'Zg',
    ]);
    expect(
      get(visibleGroupedCollections)
        .find((s) => s.group.id === 'Zg')
        ?.collections.map((c) => c.id),
    ).toEqual(['Zc']);
  });

  it('keeps the explicit "show nothing" state distinct from the stale-only state', async () => {
    // Symmetric guard: an empty array (length === 0) is the user's explicit
    // "no groups visible" choice from toggling every pill off, and must
    // continue to hide everything. The fallback only triggers when the
    // configured ids are all stale.
    groups.set({ A: makeGroup('A') });
    collections.set({});
    appConfig.set({ activeGroupFilters: [] });

    expect(get(activeGroupIds)).toEqual(new Set());
    expect(get(visibleGroupedCollections)).toEqual([]);
  });

  it('honors a partially valid filter without falling back to all', async () => {
    // If even one configured id matches a real group, that group wins —
    // the fallback only kicks in when every id is stale. Stale ids
    // continue to be ignored at read time.
    groups.set({
      A: makeGroup('A'),
      B: makeGroup('B'),
    });
    collections.set({});
    appConfig.set({ activeGroupFilters: ['A', 'stale-id'] });

    expect(get(activeGroupIds)).toEqual(new Set(['A']));
  });
});

describe('toggleGroupFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('flips an id off when starting from default-all (undefined)', async () => {
    groups.set({ g1: makeGroup('g1'), g2: makeGroup('g2') });
    expect(get(appConfig).activeGroupFilters).toBeUndefined();

    await toggleGroupFilter('g1');

    // Should materialize the full list and remove g1
    expect(get(appConfig).activeGroupFilters).toEqual(['g2']);
  });

  it('adds an id back when toggling a hidden group', async () => {
    groups.set({ g1: makeGroup('g1'), g2: makeGroup('g2') });
    appConfig.set({ activeGroupFilters: ['g1'] });

    await toggleGroupFilter('g2');

    expect(get(appConfig).activeGroupFilters).toEqual(['g1', 'g2']);
  });

  it('clears the group’s collection hides when activating it', async () => {
    collections.set({
      c1: makeCollection('c1', 'g2'),
      c2: makeCollection('c2', 'g2'),
      c3: makeCollection('c3', 'g1'),
    });
    groups.set({
      g1: makeGroup('g1', ['c3']),
      g2: makeGroup('g2', ['c1', 'c2']),
    });
    // g2 is off; c1/c2 (its collections) and c3 (another group) are hidden.
    appConfig.set({
      activeGroupFilters: ['g1'],
      inactiveCollectionFilters: ['c1', 'c2', 'c3'],
    });

    await toggleGroupFilter('g2');

    expect(get(appConfig).activeGroupFilters).toEqual(['g1', 'g2']);
    // c1/c2 revealed; c3 (belongs to another group) untouched.
    expect(get(appConfig).inactiveCollectionFilters).toEqual(['c3']);
  });

  it('leaves the deny-list alone when deactivating a group', async () => {
    collections.set({ c1: makeCollection('c1', 'g1') });
    groups.set({ g1: makeGroup('g1', ['c1']) });
    appConfig.set({
      activeGroupFilters: ['g1'],
      inactiveCollectionFilters: ['c1'],
    });

    await toggleGroupFilter('g1');

    expect(get(appConfig).activeGroupFilters).toEqual([]);
    expect(get(appConfig).inactiveCollectionFilters).toEqual(['c1']);
  });

  // Regression: with an all-stale filter list, `activeGroupIds` falls back to
  // all-active so every pill renders selected — but the raw array holds none of
  // the real ids. Reading the raw array here scored the click as an activation,
  // leaving only the clicked group visible: every pill "soloed" its group and
  // no group could be switched off.
  it('switches a group off when the stored filters are all stale', async () => {
    groups.set({ g1: makeGroup('g1'), g2: makeGroup('g2') });
    appConfig.set({ activeGroupFilters: ['gone'] });
    // Precondition: the UI shows both groups as active.
    expect(get(activeGroupIds)).toEqual(new Set(['g1', 'g2']));

    await toggleGroupFilter('g1');

    // g1 hidden, g2 still visible — and the stale id is pruned on write.
    expect(get(appConfig).activeGroupFilters).toEqual(['g2']);
    expect(get(activeGroupIds)).toEqual(new Set(['g2']));
  });
});

describe('soloGroupFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('hides every other group', async () => {
    groups.set({
      g1: makeGroup('g1'),
      g2: makeGroup('g2'),
      g3: makeGroup('g3'),
    });

    await soloGroupFilter('g2');

    expect(get(appConfig).activeGroupFilters).toEqual(['g2']);
    expect(get(activeGroupIds)).toEqual(new Set(['g2']));
  });

  it('restores all groups when soloing the group that is already alone', async () => {
    groups.set({ g1: makeGroup('g1'), g2: makeGroup('g2') });
    appConfig.set({ activeGroupFilters: ['g2'] });

    await soloGroupFilter('g2');

    // undefined, not ['g1','g2'] — back to the default-all state.
    expect(get(appConfig).activeGroupFilters).toBeUndefined();
    expect(get(activeGroupIds)).toEqual(new Set(['g1', 'g2']));
  });

  it('reveals the soloed group’s hidden collections, leaving others alone', async () => {
    collections.set({
      c1: makeCollection('c1', 'g2'),
      c2: makeCollection('c2', 'g2'),
      c3: makeCollection('c3', 'g1'),
    });
    groups.set({
      g1: makeGroup('g1', ['c3']),
      g2: makeGroup('g2', ['c1', 'c2']),
    });
    appConfig.set({ inactiveCollectionFilters: ['c1', 'c2', 'c3'] });

    await soloGroupFilter('g2');

    expect(get(appConfig).activeGroupFilters).toEqual(['g2']);
    expect(get(appConfig).inactiveCollectionFilters).toEqual(['c3']);
  });

  it('solos from an all-stale filter list rather than adding to it', async () => {
    groups.set({ g1: makeGroup('g1'), g2: makeGroup('g2') });
    appConfig.set({ activeGroupFilters: ['gone'] });

    await soloGroupFilter('g1');

    expect(get(appConfig).activeGroupFilters).toEqual(['g1']);
  });
});

describe('enableCollectionFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('activates the parent group and shows only the clicked collection', async () => {
    collections.set({
      c1: makeCollection('c1', 'g1'),
      c2: makeCollection('c2', 'g1'),
      c3: makeCollection('c3', 'g1'),
    });
    groups.set({ g1: makeGroup('g1', ['c1', 'c2', 'c3']) });
    // g1 is off (only g2-less world here) → group inactive.
    appConfig.set({ activeGroupFilters: [] });

    await enableCollectionFilter('c2');

    expect(get(appConfig).activeGroupFilters).toEqual(['g1']);
    // Siblings hidden, c2 visible.
    expect(get(appConfig).inactiveCollectionFilters?.sort()).toEqual([
      'c1',
      'c3',
    ]);
  });

  it('additively reveals a collection when its group is already active', async () => {
    collections.set({
      c1: makeCollection('c1', 'g1'),
      c2: makeCollection('c2', 'g1'),
    });
    groups.set({ g1: makeGroup('g1', ['c1', 'c2']) });
    appConfig.set({
      activeGroupFilters: ['g1'],
      inactiveCollectionFilters: ['c2'],
    });

    await enableCollectionFilter('c2');

    // Group unchanged; c2 un-hidden; siblings untouched.
    expect(get(appConfig).activeGroupFilters).toEqual(['g1']);
    expect(get(appConfig).inactiveCollectionFilters).toEqual([]);
  });

  it('reveals a collection under a default-all (undefined) group filter', async () => {
    collections.set({ c1: makeCollection('c1', 'g1') });
    groups.set({ g1: makeGroup('g1', ['c1']) });
    appConfig.set({ inactiveCollectionFilters: ['c1'] });

    await enableCollectionFilter('c1');

    // Default-all means the group is already active — no materialization.
    expect(get(appConfig).activeGroupFilters).toBeUndefined();
    expect(get(appConfig).inactiveCollectionFilters).toEqual([]);
  });

  it('just un-hides an orphan collection (no group)', async () => {
    collections.set({ c1: makeCollection('c1') });
    appConfig.set({ inactiveCollectionFilters: ['c1'] });

    await enableCollectionFilter('c1');

    expect(get(appConfig).activeGroupFilters).toBeUndefined();
    expect(get(appConfig).inactiveCollectionFilters).toEqual([]);
  });
});

describe('soloCollectionFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({
      c1: makeCollection('c1', 'g1'),
      c2: makeCollection('c2', 'g1'),
      c3: makeCollection('c3', 'g2'),
    });
    groups.set({
      g1: makeGroup('g1', ['c1', 'c2']),
      g2: makeGroup('g2', ['c3']),
    });
    appConfig.set({});
  });

  it('hides every other group and sibling collection', async () => {
    await soloCollectionFilter('c1');

    expect(get(appConfig).activeGroupFilters).toEqual(['g1']);
    expect(get(appConfig).inactiveCollectionFilters).toEqual(['c2']);
  });

  it('restores all groups when the collection is already alone', async () => {
    appConfig.set({
      activeGroupFilters: ['g1'],
      inactiveCollectionFilters: ['c2', 'c3'],
    });

    await soloCollectionFilter('c1');

    expect(get(appConfig).activeGroupFilters).toBeUndefined();
    expect(get(appConfig).inactiveCollectionFilters).toEqual(['c3']);
  });
});

describe('setActiveGroupFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('persists the filter list and dedupes', async () => {
    groups.set({ g1: makeGroup('g1'), g2: makeGroup('g2') });

    await setActiveGroupFilters(['g1', 'g2', 'g1']);

    expect(get(appConfig).activeGroupFilters).toEqual(['g1', 'g2']);
  });

  it('preserves unknown ids so URL filters survive cold refreshes before groups load', async () => {
    // Cold-refresh race: URL→config sync runs before `groups` populates from
    // the cached load. Filtering against the (still-empty) groups set here
    // would wipe valid filters and immediately rewrite the URL to `?g=`.
    // `activeGroupIds` filters stale ids at read time, so we keep them in
    // config.
    groups.set({ g1: makeGroup('g1') });

    await setActiveGroupFilters(['g1', 'g_unknown']);

    expect(get(appConfig).activeGroupFilters).toEqual(['g1', 'g_unknown']);
  });

  it('skips persistence when value is unchanged (avoids URL ↔ config loops)', async () => {
    groups.set({ g1: makeGroup('g1') });
    appConfig.set({ activeGroupFilters: ['g1'] });

    await setActiveGroupFilters(['g1']);

    // setConfig should not be called for an unchanged value
    expect(mockInbox.setConfig).not.toHaveBeenCalled();
  });
});

describe('storeGroup keeps new groups visible in filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('does not touch filters when activeGroupFilters is undefined (default-all)', async () => {
    await storeGroup(makeGroup('g_new'));
    expect(get(appConfig).activeGroupFilters).toBeUndefined();
  });

  it('appends new group id when activeGroupFilters is explicitly set', async () => {
    appConfig.set({ activeGroupFilters: ['g1'] });

    await storeGroup(makeGroup('g_new'));

    expect(get(appConfig).activeGroupFilters).toEqual(['g1', 'g_new']);
  });

  it('does not duplicate the id on update', async () => {
    appConfig.set({ activeGroupFilters: ['g1'] });
    groups.set({ g1: makeGroup('g1') });

    // "Update" of an existing group should not append again
    await storeGroup(makeGroup('g1'));

    expect(get(appConfig).activeGroupFilters).toEqual(['g1']);
  });
});

describe('moveCollectionToGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
  });

  it('updates collection groupId and group collectionIds', async () => {
    const col = makeCollection('c1');
    const group = makeGroup('g1', []);

    collections.set({ c1: col });
    groups.set({ g1: group });

    await moveCollectionToGroup('c1', 'g1');

    const updatedCol = get(collections).c1;
    expect(updatedCol.groupId).toBe('g1');

    const updatedGroup = get(groups).g1;
    expect(updatedGroup.collectionIds).toContain('c1');
  });

  it('removes collection from old group when moving to new group', async () => {
    const col = makeCollection('c1', 'g1');
    const oldGroup = makeGroup('g1', ['c1']);
    const newGroup = makeGroup('g2', []);

    collections.set({ c1: col });
    groups.set({ g1: oldGroup, g2: newGroup });

    await moveCollectionToGroup('c1', 'g2');

    const updatedOldGroup = get(groups).g1;
    expect(updatedOldGroup.collectionIds).not.toContain('c1');

    const updatedNewGroup = get(groups).g2;
    expect(updatedNewGroup.collectionIds).toContain('c1');

    expect(get(collections).c1.groupId).toBe('g2');
  });

  it('throws without mutating when target group is missing', async () => {
    const col = makeCollection('c1', 'g1');
    const group = makeGroup('g1', ['c1']);

    collections.set({ c1: col });
    groups.set({ g1: group });

    await expect(moveCollectionToGroup('c1', 'missing')).rejects.toThrow(
      'Cannot move collection to missing group',
    );

    expect(get(collections).c1.groupId).toBe('g1');
    expect(get(groups).g1.collectionIds).toEqual(['c1']);
    expect(mockInbox.storeCollection).not.toHaveBeenCalled();
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
  });
});

describe('allTodos / openTodos', () => {
  beforeEach(() => {
    items.set({});
    appConfig.set({});
  });

  it('returns every todo-like item across filed and unfiled items', () => {
    items.set({
      a: makeTodo('a', { collectionId: 'c1' }),
      b: makeTodo('b'), // unfiled
      c: {
        id: 'c',
        type: 'note',
        title: 'Note-but-todo',
        body: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        isTodo: true,
      } as InboxItem,
      // reference item — must not be surfaced as a todo
      d: {
        id: 'd',
        type: 'note',
        title: 'Plain note',
        body: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      } as InboxItem,
    });

    const all = get(allTodos)
      .map((t) => t.id)
      .sort();
    expect(all).toEqual(['a', 'b', 'c']);
  });

  it('openTodos excludes completed todos', () => {
    items.set({
      open: makeTodo('open'),
      done: makeTodo('done', {
        completed: true,
        completedAt: '2026-01-02T00:00:00.000Z',
      }),
    });

    expect(get(openTodos).map((t) => t.id)).toEqual(['open']);
  });

  it('openTodos excludes calendar-archived todos', () => {
    items.set({
      open: makeTodo('open'),
      moved: makeTodo('moved', {
        archived: true,
        archivedAt: '2026-01-02T00:00:00.000Z',
      }),
    });

    expect(get(openTodos).map((t) => t.id)).toEqual(['open']);
  });
});

describe('visibleTodos', () => {
  beforeEach(() => {
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('shows unfiled todos', () => {
    items.set({
      u1: makeTodo('u1', { createdAt: '2026-01-01T00:00:00.000Z' }),
      u2: makeTodo('u2', { createdAt: '2026-01-02T00:00:00.000Z' }),
    });

    // Newest first as the fallback sort
    expect(get(visibleTodos).map((t) => t.id)).toEqual(['u2', 'u1']);
  });

  it('hides collection todos whose group is filtered out', () => {
    items.set({
      c1: makeTodo('c1', { collectionId: 'col-active' }),
      c2: makeTodo('c2', { collectionId: 'col-hidden' }),
    });
    collections.set({
      'col-active': { ...makeCollection('col-active', 'g-active') },
      'col-hidden': { ...makeCollection('col-hidden', 'g-hidden') },
    });
    groups.set({
      'g-active': makeGroup('g-active', ['col-active']),
      'g-hidden': makeGroup('g-hidden', ['col-hidden']),
    });
    appConfig.set({
      activeGroupFilters: ['g-active'],
    });

    expect(get(visibleTodos).map((t) => t.id)).toEqual(['c1']);
  });

  it('hides todos from collections without a real group', () => {
    items.set({
      orphan: makeTodo('orphan', { collectionId: 'col-orphan' }),
    });
    collections.set({
      'col-orphan': makeCollection('col-orphan'), // no groupId
    });
    groups.set({ g1: makeGroup('g1', []) });
    appConfig.set({
      activeGroupFilters: [],
    });

    expect(get(visibleTodos)).toEqual([]);
  });

  it('keeps a todo visible when its collection is missing', () => {
    items.set({
      stale: makeTodo('stale', { collectionId: 'deleted' }),
    });
    collections.set({});

    expect(get(visibleTodos).map((t) => t.id)).toEqual(['stale']);
  });

  it('respects persisted todosGlobalOrder and falls back to newest-first for missing ids', () => {
    items.set({
      t1: makeTodo('t1', { createdAt: '2026-01-01T00:00:00.000Z' }),
      t2: makeTodo('t2', { createdAt: '2026-01-02T00:00:00.000Z' }),
      t3: makeTodo('t3', { createdAt: '2026-01-03T00:00:00.000Z' }),
    });
    // Only t2 is in the persisted order; t1/t3 fall back to createdAt desc
    appConfig.set({ todosGlobalOrder: ['t2'] });

    expect(get(visibleTodos).map((t) => t.id)).toEqual(['t2', 't3', 't1']);
  });

  it('pins due todos above the manual order, earliest due first', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const earlierToday = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    items.set({
      plain: makeTodo('plain'),
      dueOld: makeTodo('dueOld', {
        startsAt: yesterday,
        scheduleKind: 'task',
      }),
      dueToday: makeTodo('dueToday', {
        startsAt: earlierToday,
        scheduleKind: 'task',
      }),
      future: makeTodo('future', { startsAt: nextWeek, scheduleKind: 'task' }),
    });
    // Manual order puts the due items last — the band overrides it.
    appConfig.set({
      todosGlobalOrder: ['plain', 'future', 'dueToday', 'dueOld'],
    });

    expect(get(visibleTodos).map((t) => t.id)).toEqual([
      'dueOld',
      'dueToday',
      'plain',
      'future',
    ]);
  });

  it('hides calendar-archived todos; visibleOnCalendarTodos lists them newest-move-first', () => {
    items.set({
      open: makeTodo('open'),
      m1: makeTodo('m1', {
        archived: true,
        archivedAt: '2026-01-02T00:00:00.000Z',
      }),
      m2: makeTodo('m2', {
        archived: true,
        archivedAt: '2026-01-03T00:00:00.000Z',
      }),
    });

    expect(get(visibleTodos).map((t) => t.id)).toEqual(['open']);
    expect(get(visibleOnCalendarTodos).map((t) => t.id)).toEqual(['m2', 'm1']);
  });

  it('visibleOnCalendarTodos honours the group filter like visibleTodos', () => {
    items.set({
      filedMoved: makeTodo('filedMoved', {
        collectionId: 'col-hidden',
        archived: true,
        archivedAt: '2026-01-02T00:00:00.000Z',
      }),
    });
    collections.set({
      'col-hidden': makeCollection('col-hidden', 'g-hidden'),
    });
    groups.set({
      'g-active': makeGroup('g-active', []),
      'g-hidden': makeGroup('g-hidden', ['col-hidden']),
    });
    appConfig.set({ activeGroupFilters: ['g-active'] });

    expect(get(visibleOnCalendarTodos)).toEqual([]);
  });
});

describe('visibleOpenTodos (nav badge count)', () => {
  beforeEach(() => {
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('excludes completed todos from the visible set', () => {
    items.set({
      open: makeTodo('open'),
      done: makeTodo('done', { completed: true }),
    });

    expect(get(visibleOpenTodos).map((t) => t.id)).toEqual(['open']);
  });

  it('counts only todos in the focused group, matching the Todos page', () => {
    items.set({
      c1: makeTodo('c1', { collectionId: 'col-active' }),
      c2: makeTodo('c2', { collectionId: 'col-hidden' }),
      done: makeTodo('done', {
        collectionId: 'col-active',
        completed: true,
      }),
      unfiled: makeTodo('unfiled'),
    });
    collections.set({
      'col-active': makeCollection('col-active', 'g-active'),
      'col-hidden': makeCollection('col-hidden', 'g-hidden'),
    });
    groups.set({
      'g-active': makeGroup('g-active', ['col-active']),
      'g-hidden': makeGroup('g-hidden', ['col-hidden']),
    });
    // Focus only g-active: the hidden group's open todo must not be counted.
    appConfig.set({ activeGroupFilters: ['g-active'] });

    const ids = get(visibleOpenTodos)
      .map((t) => t.id)
      .sort();
    // c1 (focused) + unfiled (always visible); c2 hidden, done completed.
    expect(ids).toEqual(['c1', 'unfiled']);
  });
});

describe('reorderTodosGlobal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appConfig.set({});
  });

  it('persists the new order to appConfig.todosGlobalOrder', async () => {
    await reorderTodosGlobal(['t2', 't1', 't3']);

    expect(get(appConfig).todosGlobalOrder).toEqual(['t2', 't1', 't3']);
    expect(mockInbox.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ todosGlobalOrder: ['t2', 't1', 't3'] }),
    );
  });

  it('overwrites a previous order', async () => {
    appConfig.set({ todosGlobalOrder: ['t1', 't2'] });

    await reorderTodosGlobal(['t2', 't1']);

    expect(get(appConfig).todosGlobalOrder).toEqual(['t2', 't1']);
  });
});

// ---- deleteCollection: must-be-empty guard ----
//
// Mirrors the deleteGroup rule so the UI can't silently orphan filed items on
// an accidental tap. Items are matched by their live `collectionId` rather
// than the collection's `itemIds` array, which can drift out of sync after
// partial writes.

describe('deleteCollection: empty-only guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('refuses to delete a collection that still has items', async () => {
    collections.set({ c1: makeCollection('c1') });
    items.set({
      i1: {
        id: 'i1',
        type: 'note',
        title: 'kept',
        body: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        collectionId: 'c1',
      } as InboxItem,
    });

    const ok = await deleteCollection('c1');

    expect(ok).toBe(false);
    expect(get(collections).c1).toBeDefined();
    expect(get(items).i1.collectionId).toBe('c1'); // item untouched
    expect(mockInbox.removeCollection).not.toHaveBeenCalled();
    expect(mockInbox.store).not.toHaveBeenCalled(); // no orphaning side effect
  });

  it('deletes an empty collection and removes it from collectionsOrder', async () => {
    collections.set({ c1: makeCollection('c1'), c2: makeCollection('c2') });
    appConfig.set({ collectionsOrder: ['c1', 'c2'] });

    const ok = await deleteCollection('c1');

    expect(ok).toBe(true);
    expect(get(collections).c1).toBeUndefined();
    expect(get(collections).c2).toBeDefined();
    expect(get(appConfig).collectionsOrder).toEqual(['c2']);
    expect(mockInbox.removeCollection).toHaveBeenCalledWith('c1');
  });

  it('returns false for a non-existent collection without touching storage', async () => {
    const ok = await deleteCollection('does-not-exist');
    expect(ok).toBe(false);
    expect(mockInbox.removeCollection).not.toHaveBeenCalled();
  });

  it('checks live item.collectionId rather than the (possibly stale) itemIds array', async () => {
    // Collection still lists i1 in itemIds, but the item itself was moved
    // elsewhere — the collection is effectively empty and should delete.
    const col = makeCollection('c1');
    col.itemIds = ['i1'];
    collections.set({ c1: col, c2: makeCollection('c2') });
    items.set({
      i1: {
        id: 'i1',
        type: 'note',
        title: 'moved away',
        body: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        collectionId: 'c2',
      } as InboxItem,
    });

    const ok = await deleteCollection('c1');

    expect(ok).toBe(true);
    expect(get(collections).c1).toBeUndefined();
  });
});

describe('createCollection: group assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('honours an explicit groupId and wires up the back-reference', async () => {
    groups.set({ g1: makeGroup('g1') });
    const col = makeCollection('c1', 'g1');

    const stored = await createCollection(col);

    expect(stored.groupId).toBe('g1');
    expect(get(collections).c1.groupId).toBe('g1');
    expect(get(groups).g1.collectionIds).toContain('c1');
    expect(get(groupCollections).g1.map((c) => c.id)).toEqual(['c1']);
    // No new group was auto-created
    expect(Object.keys(get(groups))).toEqual(['g1']);
  });

  it('rejects collection creation without a real group', async () => {
    await expect(createCollection(makeCollection('c1'))).rejects.toThrow(
      'Cannot create collection without a real group',
    );
    expect(get(collections).c1).toBeUndefined();
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
  });

  it('rejects collection creation with a missing group', async () => {
    await expect(
      createCollection(makeCollection('c1', 'missing')),
    ).rejects.toThrow('Cannot create collection without a real group');
    expect(get(collections).c1).toBeUndefined();
  });
});

describe('load-time collection/group loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
    mockInbox.getAll.mockResolvedValue({});
    mockInbox.getConfig.mockResolvedValue({});
    mockInbox.getUserSettings.mockResolvedValue(undefined);
  });

  it('loads collections without a group without creating or assigning organization', async () => {
    mockInbox.getAllCollections.mockResolvedValue({ c1: makeCollection('c1') });
    mockInbox.getAllGroups.mockResolvedValue({});

    await rsHandlers.connected();

    expect(get(collections).c1.groupId).toBeUndefined();
    expect(get(groups)).toEqual({});
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
    expect(mockInbox.storeCollection).not.toHaveBeenCalled();
  });

  it('loads collections with a missing groupId without rewriting them', async () => {
    const g1 = makeGroup('g1');
    mockInbox.getAllCollections.mockResolvedValue({
      c1: makeCollection('c1', 'deleted-group'),
    });
    mockInbox.getAllGroups.mockResolvedValue({ g1 });

    await rsHandlers.connected();

    expect(get(collections).c1.groupId).toBe('deleted-group');
    expect(get(groups)).toEqual({ g1 });
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
    expect(mockInbox.storeCollection).not.toHaveBeenCalled();
  });

  it('does not mutate collections when groups fail to load', async () => {
    const existing = makeGroup('g1', ['c1']);
    groups.set({ g1: existing });
    collections.set({ c1: makeCollection('c1', 'g1') });
    mockInbox.getAllCollections.mockResolvedValue({
      c1: makeCollection('c1', 'g1'),
    });
    mockInbox.getAllGroups.mockRejectedValue(
      new Error('temporary groups read failure'),
    );

    await rsHandlers.connected();

    expect(get(collections).c1.groupId).toBe('g1');
    expect(get(groups).g1).toBeDefined();
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
    expect(mockInbox.storeCollection).not.toHaveBeenCalled();
  });
});

describe('removeItemFromCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('clears collectionId on the item and removes it from the collection itemIds', async () => {
    const item = makeTodo('t1', { collectionId: 'c1' });
    const col = { ...makeCollection('c1'), itemIds: ['t1'] };

    items.set({ t1: item });
    collections.set({ c1: col });

    await removeItemFromCollection('t1');

    expect(get(items).t1.collectionId).toBeUndefined();
    expect(get(collections).c1.itemIds).toEqual([]);
    expect(mockInbox.store).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
    );
    expect(mockInbox.storeCollection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', itemIds: [] }),
    );
  });

  it('is a no-op when the item does not exist in the store', async () => {
    collections.set({ c1: { ...makeCollection('c1'), itemIds: [] } });

    await removeItemFromCollection('nonexistent');

    expect(mockInbox.store).not.toHaveBeenCalled();
    expect(mockInbox.storeCollection).not.toHaveBeenCalled();
  });

  it('works for an unfiled item (no-op on collections)', async () => {
    // Item has no collectionId — removing from collection is essentially a no-op
    // on the collections side but should not throw.
    const item = makeTodo('t1');
    items.set({ t1: item });

    await removeItemFromCollection('t1');

    // item.collectionId stays absent and no collection write occurs
    expect(get(items).t1.collectionId).toBeUndefined();
    expect(mockInbox.storeCollection).not.toHaveBeenCalled();
  });

  it('leaves the item visible as an unfiled todo after removal', async () => {
    const item = makeTodo('t1', { collectionId: 'c1' });
    const col = { ...makeCollection('c1'), itemIds: ['t1'] };

    items.set({ t1: item });
    collections.set({ c1: col });

    await removeItemFromCollection('t1');

    // Should now appear in todoItems (unfiled todos)
    expect(get(todoItems).map((t) => t.id)).toContain('t1');
  });

  it('rolls back the item and collection on persistence error', async () => {
    const item = makeTodo('t1', { collectionId: 'c1' });
    const col = { ...makeCollection('c1'), itemIds: ['t1'] };

    items.set({ t1: item });
    collections.set({ c1: col });

    // The item write succeeds; the follow-up source-collection write fails
    // mid-flight (delegated through moveItemToCollection).
    mockInbox.storeCollection.mockRejectedValueOnce(new Error('write failed'));

    await expect(removeItemFromCollection('t1')).rejects.toThrow(
      'write failed',
    );

    // Both stores must roll back: the item stays filed in c1 and c1 still lists it.
    expect(get(items).t1.collectionId).toBe('c1');
    expect(get(collections).c1.itemIds).toEqual(['t1']);
  });
});

describe('reorderCollectionItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('updates collection itemIds in the store and persists to storage', async () => {
    const col = { ...makeCollection('c1'), itemIds: ['t1', 't2', 't3'] };
    collections.set({ c1: col });

    await reorderCollectionItems('c1', ['t3', 't1', 't2']);

    expect(get(collections).c1.itemIds).toEqual(['t3', 't1', 't2']);
    expect(mockInbox.storeCollection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', itemIds: ['t3', 't1', 't2'] }),
    );
  });

  it('is a no-op when the collection does not exist', async () => {
    collections.set({});

    await reorderCollectionItems('missing', ['t1', 't2']);

    expect(mockInbox.storeCollection).not.toHaveBeenCalled();
  });

  it('accepts an empty itemIds array', async () => {
    const col = { ...makeCollection('c1'), itemIds: ['t1', 't2'] };
    collections.set({ c1: col });

    await reorderCollectionItems('c1', []);

    expect(get(collections).c1.itemIds).toEqual([]);
    expect(mockInbox.storeCollection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', itemIds: [] }),
    );
  });

  it('does not affect other collections', async () => {
    const c1 = { ...makeCollection('c1'), itemIds: ['t1', 't2'] };
    const c2 = { ...makeCollection('c2'), itemIds: ['t3', 't4'] };
    collections.set({ c1, c2 });

    await reorderCollectionItems('c1', ['t2', 't1']);

    expect(get(collections).c1.itemIds).toEqual(['t2', 't1']);
    expect(get(collections).c2.itemIds).toEqual(['t3', 't4']);
  });

  it('rolls back store on persistence error', async () => {
    const col = { ...makeCollection('c1'), itemIds: ['t1', 't2'] };
    collections.set({ c1: col });
    mockInbox.storeCollection.mockRejectedValueOnce(new Error('write failed'));

    await expect(reorderCollectionItems('c1', ['t2', 't1'])).rejects.toThrow(
      'write failed',
    );

    // Should be rolled back to the original order
    expect(get(collections).c1.itemIds).toEqual(['t1', 't2']);
  });
});

describe('reorderGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    groups.set({});
    appConfig.set({});
  });

  it('persists the new group order into appConfig.groupsOrder', async () => {
    groups.set({
      g1: makeGroup('g1'),
      g2: makeGroup('g2'),
      g3: makeGroup('g3'),
    });

    await reorderGroups(['g3', 'g1', 'g2']);

    expect(get(appConfig).groupsOrder).toEqual(['g3', 'g1', 'g2']);
    expect(mockInbox.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ groupsOrder: ['g3', 'g1', 'g2'] }),
    );
  });

  it('overwrites a previous groupsOrder', async () => {
    appConfig.set({ groupsOrder: ['g1', 'g2'] });

    await reorderGroups(['g2', 'g1']);

    expect(get(appConfig).groupsOrder).toEqual(['g2', 'g1']);
  });

  it('accepts an empty order array', async () => {
    appConfig.set({ groupsOrder: ['g1', 'g2'] });

    await reorderGroups([]);

    expect(get(appConfig).groupsOrder).toEqual([]);
    expect(mockInbox.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ groupsOrder: [] }),
    );
  });

  it('does not touch other config keys', async () => {
    appConfig.set({ todosGlobalOrder: ['t1'], groupsOrder: ['g1'] });

    await reorderGroups(['g2', 'g1']);

    expect(get(appConfig).todosGlobalOrder).toEqual(['t1']);
  });

  it('rolls back groupsOrder on persistence error', async () => {
    appConfig.set({ groupsOrder: ['g1', 'g2'] });
    // reorderGroups delegates to updateConfig, which rolls appConfig back
    // when setConfig rejects.
    mockInbox.setConfig.mockRejectedValueOnce(new Error('write failed'));

    await expect(reorderGroups(['g2', 'g1'])).rejects.toThrow('write failed');

    expect(get(appConfig).groupsOrder).toEqual(['g1', 'g2']);
  });
});
