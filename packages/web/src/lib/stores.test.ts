// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

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

import {
  blobUrls, connected, loadFileBlobUrl,
  collections, groups, groupCollections, moveCollectionToGroup,
  deleteGroup, appConfig,
  storeCollection, createCollection, deleteCollection,
  storeItem,
  reorderGroupCollections, items, todoItems, reorderUncategorizedTodos, pendingMigrationCount,
  moveItemToCollection,
  collectionItems, userSettings,
  activeGroupIds, visibleGroupedCollections,
  toggleGroupFilter, setActiveGroupFilters, storeGroup,
  allTodos, openTodos, visibleTodos, reorderTodosGlobal,
  uncategorizedFilterActive, toggleUncategorizedFilter,
  UNCATEGORIZED_FILTER_ID,
  UNCATEGORIZED_COLLECTION_ID, uncategorizedVirtualCollection,
} from './stores';
import type { Collection, CollectionGroup, InboxItem } from '@inbox-rs/rs-module';

/**
 * rs.on() handlers are registered at module load time.
 * Capture them once before any test clears mocks.
 * Multiple handlers may be registered per event (e.g. sync-done has
 * hideSync, scheduleReload, and a debug logger).
 */
const rsHandlerMap: Record<string, Array<(...args: any[]) => any>> = {};
function captureRsHandlers() {
  if (Object.keys(rsHandlerMap).length > 0) return;
  for (const [event, handler] of mockRs.on.mock.calls as [string, (...args: any[]) => any][]) {
    (rsHandlerMap[event] ??= []).push(handler);
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
const onChangeHandler = mockInbox.onChange.mock.calls[0]?.[0] as ((event: any) => void) | undefined;

/** Simulate a remoteStorage module change event with per-item data */
function emitModuleChange(event: { relativePath: string; origin?: string; newValue?: any; oldValue?: any }) {
  if (onChangeHandler) onChangeHandler({ origin: 'remote', ...event });
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

    expect(mockFetchFileBlobUrl).toHaveBeenCalledWith('files/photo.jpg', undefined);
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

    expect(mockFetchFileBlobUrl).toHaveBeenCalledWith('files/photo.jpg', 'image/jpeg');
  });

  it('does not fetch if blob URL already exists', () => {
    blobUrls.set({ 'files/photo.jpg': 'blob:existing/456' });

    loadFileBlobUrl('files/photo.jpg');

    expect(mockFetchFileBlobUrl).not.toHaveBeenCalled();
  });

  it('does not fetch if not connected', () => {
    connected.set(false);

    loadFileBlobUrl('files/photo.jpg');

    expect(mockFetchFileBlobUrl).not.toHaveBeenCalled();
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
    await new Promise(r => setTimeout(r, 10));
    expect(get(blobUrls)['files/missing.jpg']).toBeUndefined();
  });

  it('deduplicates concurrent requests for the same path', async () => {
    let resolveFirst!: (url: string) => void;
    mockFetchFileBlobUrl.mockReturnValue(
      new Promise<string>(r => { resolveFirst = r; })
    );

    loadFileBlobUrl('files/photo.jpg');
    loadFileBlobUrl('files/photo.jpg');
    loadFileBlobUrl('files/photo.jpg');

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
    await new Promise(r => setTimeout(r, 10));

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
    expect(result['g1']).toHaveLength(2);
    expect(result['g1'][0].id).toBe('c1');
    expect(result['g1'][1].id).toBe('c2');
  });

  it('shows collections with groupId but missing from collectionIds', () => {
    const col1 = makeCollection('c1', 'g1');
    const col2 = makeCollection('c2', 'g1');
    // Group only knows about c1, but c2 also has groupId pointing here
    const group = makeGroup('g1', ['c1']);

    collections.set({ c1: col1, c2: col2 });
    groups.set({ g1: group });

    const result = get(groupCollections);
    expect(result['g1']).toHaveLength(2);
    expect(result['g1'][0].id).toBe('c1');
    expect(result['g1'][1].id).toBe('c2');
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
    expect(result['g1'].map(c => c.id)).toEqual(['c2', 'c1', 'c3']);
  });

  it('filters out stale collectionIds entries', () => {
    const col1 = makeCollection('c1', 'g1');
    // Group references c1 and c_deleted, but c_deleted doesn't exist
    const group = makeGroup('g1', ['c1', 'c_deleted']);

    collections.set({ c1: col1 });
    groups.set({ g1: group });

    const result = get(groupCollections);
    expect(result['g1']).toHaveLength(1);
    expect(result['g1'][0].id).toBe('c1');
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
    expect(result['g1']).toHaveLength(0);
    expect(result['g2']).toHaveLength(1);
    expect(result['g2'][0].id).toBe('c1');
  });

  it('returns empty array for group with no collections', () => {
    const group = makeGroup('g1', []);
    groups.set({ g1: group });

    const result = get(groupCollections);
    expect(result['g1']).toEqual([]);
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

    expect(mockInbox.store).toHaveBeenCalledWith(todo, undefined);
    expect(get(items).quick).toMatchObject({
      id: 'quick',
      title: 'Quick thought',
      type: 'todo',
      completed: false,
      isTodo: true,
    });
    expect(get(items).quick.collectionId).toBeUndefined();
    expect(get(todoItems).map(t => t.id)).toEqual(['quick']);
  });

  it('keeps configured open todo order and falls back to newest-first for new todos', () => {
    items.set({
      t1: makeTodo('t1', { createdAt: '2026-01-01T00:00:00.000Z' }),
      t2: makeTodo('t2', { createdAt: '2026-01-02T00:00:00.000Z' }),
      t3: makeTodo('t3', { createdAt: '2026-01-03T00:00:00.000Z' }),
    });
    appConfig.set({ todosGlobalOrder: ['t2'] });

    expect(get(todoItems).map(todo => todo.id)).toEqual(['t2', 't3', 't1']);
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

    expect(get(todoItems).map(todo => todo.id)).toEqual(['open', 'done-newer', 'done-older']);
  });

  it('persists reordered uncategorized todo ids into todosGlobalOrder', async () => {
    appConfig.set({});
    items.set({
      t1: makeTodo('t1'),
      t2: makeTodo('t2'),
      t3: makeTodo('t3'),
    });

    await reorderUncategorizedTodos(['t3', 't1', 't2']);

    expect(get(appConfig).todosGlobalOrder).toEqual(['t3', 't1', 't2']);
    expect(mockInbox.setConfig).toHaveBeenCalledWith({ todosGlobalOrder: ['t3', 't1', 't2'] });
  });

  it('splices uncategorized reorders into todosGlobalOrder without moving categorized todos', async () => {
    // Two categorized todos (c1, c2) flanking three uncategorized (u1, u2, u3).
    // Reordering the uncategorized subset must preserve c1/c2's global
    // positions — the flat /todos page relies on that to not scramble the
    // order of todos it doesn't even see in the Uncategorized view.
    items.set({
      c1: makeTodo('c1', { collectionId: 'col-a' }),
      c2: makeTodo('c2', { collectionId: 'col-b' }),
      u1: makeTodo('u1'),
      u2: makeTodo('u2'),
      u3: makeTodo('u3'),
    });
    appConfig.set({ todosGlobalOrder: ['u1', 'c1', 'u2', 'c2', 'u3'] });

    await reorderUncategorizedTodos(['u3', 'u1', 'u2']);

    // u1/u2/u3 occupy the same global slots they did before; only their
    // relative order has changed. c1 and c2 stay exactly where they were.
    expect(get(appConfig).todosGlobalOrder).toEqual(['u3', 'c1', 'u1', 'c2', 'u2']);
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

  it('ignores item records whose storage key does not match the item id', async () => {
    const canonical = makeTodo('t1', { collectionId: 'c1' });
    const stale = makeTodo('t1');
    mockInbox.getAll.mockResolvedValue({
      stale_copy: stale,
      t1: canonical,
    });

    await rsHandlers['connected']();

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

    expect(get(collectionItems)['c1']).toEqual([]);
    expect(get(todoItems).map(todo => todo.id)).toEqual(['t1']);
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

    expect(get(collections)['source'].itemIds).toEqual([]);
    expect(get(collections)['target'].itemIds).toEqual(['t1']);
    expect(get(items)['t1'].collectionId).toBe('target');
  });

  it('adds to the target collection itemIds when moving from uncategorized', async () => {
    const item = makeTodo('t1'); // no collectionId
    const target = { ...makeCollection('target'), itemIds: [] };

    items.set({ t1: item });
    collections.set({ target: target });

    await moveItemToCollection('t1', 'target');

    expect(get(collections)['target'].itemIds).toEqual(['t1']);
    expect(get(items)['t1'].collectionId).toBe('target');
    expect((get(items)['t1'] as any).uncategorized).toBeUndefined();
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
    expect(get(groups)['g1']).toBeDefined();
  });

  it('refuses to delete a group when collectionIds and groupId both reference it', async () => {
    const col = makeCollection('c1', 'g1');
    const group = makeGroup('g1', ['c1']);

    collections.set({ c1: col });
    groups.set({ g1: group });

    const result = await deleteGroup('g1');

    expect(result).toBe(false);
    expect(get(groups)['g1']).toBeDefined();
  });

  it('allows deleting a group with no collections referencing it', async () => {
    const group = makeGroup('g1', []);

    groups.set({ g1: group });

    const result = await deleteGroup('g1');

    expect(result).toBe(true);
    expect(get(groups)['g1']).toBeUndefined();
  });

  it('allows deleting a group where collectionIds has stale entries but no collection has matching groupId', async () => {
    // collectionIds references c_deleted which doesn't exist, and c1 has groupId pointing elsewhere
    const col = makeCollection('c1', 'g2');
    const group = makeGroup('g1', ['c_deleted']);

    collections.set({ c1: col });
    groups.set({ g1: group, g2: makeGroup('g2', ['c1']) });

    const result = await deleteGroup('g1');

    expect(result).toBe(true);
    expect(get(groups)['g1']).toBeUndefined();
  });
});

describe('pendingMigrationCount visibility timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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
    mockInbox.getAll.mockResolvedValue({ legacy: makeLegacyVoiceMemo('legacy') });

    await rsHandlers['connected']();

    expect(get(pendingMigrationCount)).toBe(0);

    emitRsEvent('sync-done');

    expect(get(pendingMigrationCount)).toBe(1);
  });

  it('shows migration count after the fallback timeout when no sync signal arrives', async () => {
    mockInbox.getAll.mockResolvedValue({ legacy: makeLegacyVoiceMemo('legacy') });

    await rsHandlers['connected']();

    expect(get(pendingMigrationCount)).toBe(0);

    await vi.advanceTimersByTimeAsync(2500);

    expect(get(pendingMigrationCount)).toBe(1);
  });

  it('does not count docs that only need a version bump with no content change', async () => {
    mockInbox.getAll.mockResolvedValue({ note1: makeVersionedNote('note1', 1) });

    await rsHandlers['connected']();
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
    expect(get(groups)['g1']).toBeUndefined();

    // An unrelated item change should not recreate the deleted group
    emitModuleChange({
      relativePath: 'items/i1',
      newValue: { id: 'i1', type: 'note', title: 'X', createdAt: '2026-01-01T00:00:00.000Z' },
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

  it('adds an incoming item to the store', () => {
    const item = { id: 'i1', type: 'note', title: 'Test', createdAt: '2026-01-01T00:00:00.000Z' };
    emitModuleChange({ relativePath: 'items/i1', newValue: item });

    expect(get(items)['i1']).toBeDefined();
    expect(get(items)['i1'].title).toBe('Test');
  });

  it('removes a deleted item from the store', () => {
    items.set({ i1: { id: 'i1', type: 'note', title: 'Old', createdAt: '2026-01-01T00:00:00.000Z' } as InboxItem });

    emitModuleChange({ relativePath: 'items/i1', newValue: undefined, oldValue: { id: 'i1' } });

    expect(get(items)['i1']).toBeUndefined();
  });

  it('adds an incoming collection with itemIds normalization', () => {
    const col = { id: 'c1', name: 'Test', createdAt: '2026-01-01T00:00:00.000Z' };
    emitModuleChange({ relativePath: 'collections/c1', newValue: col });

    expect(get(collections)['c1']).toBeDefined();
    expect(get(collections)['c1'].itemIds).toEqual([]);
  });

  it('adds an incoming group with collectionIds normalization', () => {
    const grp = { id: 'g1', name: 'Test Group', createdAt: '2026-01-01T00:00:00.000Z' };
    emitModuleChange({ relativePath: 'groups/g1', newValue: grp });

    expect(get(groups)['g1']).toBeDefined();
    expect(get(groups)['g1'].collectionIds).toEqual([]);
  });

  it('updates appConfig on config/app change', () => {
    emitModuleChange({ relativePath: 'config/app', newValue: { todosGlobalOrder: ['t1', 't2'] } });

    expect(get(appConfig).todosGlobalOrder).toEqual(['t1', 't2']);
  });

  it('updates userSettings on config/user change', () => {
    emitModuleChange({ relativePath: 'config/user', newValue: { theme: 'dark' } });

    expect((get(userSettings) as any).theme).toBe('dark');
  });

  it('ignores window-origin events (local writes already update stores)', () => {
    emitModuleChange({ relativePath: 'items/i1', origin: 'window', newValue: { id: 'i1', type: 'note', title: 'X', createdAt: '' } });

    expect(get(items)['i1']).toBeUndefined();
  });

  it('handles multiple incoming items without calling getAll', () => {
    for (let i = 0; i < 5; i++) {
      emitModuleChange({
        relativePath: `items/i${i}`,
        newValue: { id: `i${i}`, type: 'note', title: `Note ${i}`, createdAt: '2026-01-01T00:00:00.000Z' },
      });
    }

    expect(Object.keys(get(items))).toHaveLength(5);
    expect(mockInbox.getAll).not.toHaveBeenCalled();
  });

  it('removes a deleted collection from the store', () => {
    collections.set({ c1: makeCollection('c1') });

    emitModuleChange({ relativePath: 'collections/c1', newValue: undefined, oldValue: { id: 'c1' } });

    expect(get(collections)['c1']).toBeUndefined();
  });

  it('removes a deleted group from the store', () => {
    groups.set({ g1: makeGroup('g1') });

    emitModuleChange({ relativePath: 'groups/g1', newValue: undefined, oldValue: { id: 'g1' } });

    expect(get(groups)['g1']).toBeUndefined();
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
    expect(get(groups)['g1']).toBeUndefined();
    expect(get(groups)['g2']).toBeDefined();
    expect(get(collections)['c1']).toBeDefined();
    expect(get(collections)['c1'].groupId).toBe('g2');
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
    expect(get(collections)['c1'].groupId).toBe('g2');
    expect(get(collections)['c2'].groupId).toBeUndefined();
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
    expect(get(groups)['g1']).toBeDefined();
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

    expect(get(collections)['c1']).toBeDefined();
    expect(get(collections)['c1'].groupId).toBeUndefined();
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

    expect(get(collections)['c1'].groupId).toBe('');
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
    expect(get(groups)['g1'].collectionIds).toEqual(['c1', 'c2']);
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
  });

  it('reorderGroupCollections with valid groupId works normally', async () => {
    const group = makeGroup('g1', ['c1', 'c2']);
    const col1 = makeCollection('c1', 'g1');
    const col2 = makeCollection('c2', 'g1');

    collections.set({ c1: col1, c2: col2 });
    groups.set({ g1: group });

    await reorderGroupCollections('g1', ['c2', 'c1']);

    expect(get(groups)['g1'].collectionIds).toEqual(['c2', 'c1']);
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
    // Disable the Uncategorized pill so this test stays focused on real-group
    // behaviour.
    appConfig.set({ uncategorizedFilterActive: false });

    const sections = get(visibleGroupedCollections);
    expect(sections).toHaveLength(1);
    expect(sections[0].group.id).toBe('g1');
    expect(sections[0].collections.map(c => c.id)).toEqual(['c2', 'c1']);
  });

  it('omits groups that are filtered out', () => {
    collections.set({});
    groups.set({
      g1: makeGroup('g1', []),
      g2: makeGroup('g2', []),
    });
    appConfig.set({ activeGroupFilters: ['g2'], uncategorizedFilterActive: false });

    const sections = get(visibleGroupedCollections);
    expect(sections.map(s => s.group.id)).toEqual(['g2']);
  });

  it('returns empty when all groups are filtered out', () => {
    groups.set({ g1: makeGroup('g1', []) });
    appConfig.set({ activeGroupFilters: [], uncategorizedFilterActive: false });
    expect(get(visibleGroupedCollections)).toHaveLength(0);
  });

  it('places the Uncategorized section at the sentinel slot in groupsOrder', () => {
    const grouped = makeCollection('c1', 'g1');
    const grouped2 = makeCollection('c3', 'g2');
    collections.set({ c1: grouped, c3: grouped2 });
    groups.set({ g1: makeGroup('g1', ['c1']), g2: makeGroup('g2', ['c3']) });
    items.set({
      t1: { id: 't1', type: 'todo', title: 'straggler', createdAt: '2026-01-01T00:00:00Z', completed: false, isTodo: true } as any,
    });
    // Sentinel placed between g1 and g2
    appConfig.set({ groupsOrder: ['g1', UNCATEGORIZED_FILTER_ID, 'g2'] });

    const sections = get(visibleGroupedCollections);
    expect(sections.map(s => s.group.id)).toEqual(['g1', UNCATEGORIZED_FILTER_ID, 'g2']);
  });

  it('hides the Uncategorized section when the pill is off even if straggler items exist', () => {
    items.set({
      t1: { id: 't1', type: 'todo', title: 'straggler', createdAt: '2026-01-01T00:00:00Z', completed: false, isTodo: true } as any,
    });
    groups.set({});
    appConfig.set({ uncategorizedFilterActive: false });

    expect(get(visibleGroupedCollections)).toHaveLength(0);
  });

  it('hides the Uncategorized section when there are no straggler items', () => {
    // Uncategorized is a dynamic surface — unlike a real group, it has no
    // persistent identity for the user to "keep". When everything is filed
    // (all collections have a group, all items have a collection, no
    // orphans), the Uncategorized section collapses away entirely.
    const grouped = makeCollection('c1', 'g1');
    collections.set({ c1: grouped });
    groups.set({ g1: makeGroup('g1', ['c1']) });

    const sections = get(visibleGroupedCollections);
    expect(sections.map(s => s.group.id)).toEqual(['g1']);
  });

  it('renders the Uncategorized section when there are straggler items', () => {
    // A loose todo or an orphaned ref is enough to bring the Uncategorized
    // surface back — the straggler needs somewhere to live.
    const grouped = makeCollection('c1', 'g1');
    collections.set({ c1: grouped });
    groups.set({ g1: makeGroup('g1', ['c1']) });
    const straggler: InboxItem = { id: 't1', type: 'todo', title: 'straggler', createdAt: '2026-01-01T00:00:00Z', completed: false, isTodo: true } as any;
    items.set({ t1: straggler });

    const sections = get(visibleGroupedCollections);
    expect(sections.map(s => s.group.id)).toEqual(['g1', UNCATEGORIZED_FILTER_ID]);
    expect(sections[1].collections).toEqual([]);
  });

  it('attaches the virtual Uncategorized collection to the Uncategorized section when stragglers exist', () => {
    // The virtual collection is exposed on `section.virtualCollection` so
    // CollectionsPage can render straggler items without creating a real
    // collection or group destination.
    collections.set({});
    groups.set({});
    const straggler: InboxItem = { id: 't1', type: 'todo', title: 'straggler', createdAt: '2026-01-01T00:00:00Z', completed: false, isTodo: true } as any;
    items.set({ t1: straggler });

    const sections = get(visibleGroupedCollections);
    const uncat = sections.find(s => s.group.id === UNCATEGORIZED_FILTER_ID);
    expect(uncat).toBeDefined();
    expect(uncat!.virtualCollection?.id).toBe(UNCATEGORIZED_COLLECTION_ID);
    expect(uncat!.virtualCollection?.name).toBe('Uncategorized');
  });
});

describe('uncategorizedVirtualCollection', () => {
  beforeEach(() => {
    items.set({});
    appConfig.set({});
  });

  it('has a stable sentinel id and a placeholder createdAt even with no items', () => {
    const virt = get(uncategorizedVirtualCollection);
    expect(virt.id).toBe(UNCATEGORIZED_COLLECTION_ID);
    expect(virt.itemIds).toEqual([]);
    // Placeholder createdAt (epoch) — the virtual collection isn't stored, so
    // there's no real creation timestamp to reference.
    expect(virt.createdAt).toBe(new Date(0).toISOString());
  });

  it('includes every straggler — todos without a collection, plus refs explicitly flagged uncategorized', () => {
    // Todos can't live in the Inbox, so any todo without a `collectionId`
    // is implicitly a straggler. Refs, by contrast, default to the Inbox and
    // only land here when explicitly flagged `uncategorized: true` (e.g.
    // orphaned by a collection deletion). Order: todos first (open then
    // completed, via todoItems), then refs (newest first, via
    // uncategorizedReferenceItems).
    const todo1: InboxItem = { id: 't1', type: 'todo', title: 'first', createdAt: '2026-01-01T00:00:00Z', completed: false, isTodo: true } as any;
    const note1: InboxItem = { id: 'n1', type: 'note', title: 'note', body: 'x', createdAt: '2026-01-02T00:00:00Z', uncategorized: true } as any;
    items.set({ t1: todo1, n1: note1 });

    const virt = get(uncategorizedVirtualCollection);
    expect(virt.itemIds).toEqual(['t1', 'n1']);
  });

  it('excludes refs without the `uncategorized` flag — those live in the Inbox, not Uncategorized', () => {
    // Refs without a collectionId and without the `uncategorized` flag are
    // *Inbox* items, not stragglers. They must not surface in the virtual
    // Uncategorized collection.
    const inboxRef: InboxItem = { id: 'n1', type: 'note', title: 'inbox', body: 'x', createdAt: '2026-01-01T00:00:00Z' } as any;
    items.set({ n1: inboxRef });

    const virt = get(uncategorizedVirtualCollection);
    expect(virt.itemIds).toEqual([]);
  });

  it('excludes items that are assigned to a real collection', () => {
    const uncat: InboxItem = { id: 't1', type: 'todo', title: 'uncat', createdAt: '2026-01-01T00:00:00Z', completed: false, isTodo: true } as any;
    const assigned: InboxItem = { id: 't2', type: 'todo', title: 'assigned', createdAt: '2026-01-02T00:00:00Z', completed: false, isTodo: true, collectionId: 'c1' } as any;
    const assignedRef: InboxItem = { id: 'n1', type: 'note', title: 'note', body: 'x', createdAt: '2026-01-03T00:00:00Z', collectionId: 'c1' } as any;
    items.set({ t1: uncat, t2: assigned, n1: assignedRef });

    const virt = get(uncategorizedVirtualCollection);
    expect(virt.itemIds).toEqual(['t1']);
  });

  it('orders todos before refs, with completed todos between the two', () => {
    // `todoItems` enforces open-first-then-completed for todos;
    // `uncategorizedReferenceItems` returns refs newest-first. Concatenating
    // them yields: open todos, completed todos, refs (newest first). Refs
    // need the `uncategorized: true` flag to surface here — without it they'd
    // default to the Inbox.
    const openTodo: InboxItem = { id: 't-open', type: 'todo', title: 'open', createdAt: '2026-01-01T00:00:00Z', completed: false, isTodo: true } as any;
    const doneTodo: InboxItem = { id: 't-done', type: 'todo', title: 'done', createdAt: '2026-01-02T00:00:00Z', completed: true, isTodo: true, completedAt: '2026-01-02T00:00:00Z' } as any;
    const oldRef: InboxItem = { id: 'r-old', type: 'note', title: 'old', body: '', createdAt: '2026-01-01T00:00:00Z', uncategorized: true } as any;
    const newRef: InboxItem = { id: 'r-new', type: 'note', title: 'new', body: '', createdAt: '2026-01-05T00:00:00Z', uncategorized: true } as any;
    items.set({ 't-open': openTodo, 't-done': doneTodo, 'r-old': oldRef, 'r-new': newRef });

    const virt = get(uncategorizedVirtualCollection);
    expect(virt.itemIds).toEqual(['t-open', 't-done', 'r-new', 'r-old']);
  });
});

describe('collectionItems virtual Uncategorized entry', () => {
  beforeEach(() => {
    items.set({});
    collections.set({});
  });

  it('surfaces every straggler under UNCATEGORIZED_COLLECTION_ID — todos, and refs flagged uncategorized', () => {
    // Orphan todo (no collectionId) — every uncollected todo is a straggler
    // since todos can't live in the Inbox.
    const todo: InboxItem = { id: 't1', type: 'todo', title: 'orphan todo', createdAt: '2026-01-01T00:00:00Z', completed: false, isTodo: true } as any;
    // Orphaned reference flagged `uncategorized: true` — set when the user
    // explicitly chose Uncategorized in the picker, or when an item is moved
    // out of its collection without picking a new destination
    // (`moveItemToCollection(id, undefined)`). Refs without this flag default
    // to the Inbox, not Uncategorized.
    const orphanRef: InboxItem = { id: 'r1', type: 'note', title: 'orphan ref', body: '', createdAt: '2026-01-02T00:00:00Z', uncategorized: true } as any;
    // Items assigned to a real collection — must not leak.
    const assignedTodo: InboxItem = { id: 't2', type: 'todo', title: 'assigned', createdAt: '2026-01-03T00:00:00Z', completed: false, isTodo: true, collectionId: 'c1' } as any;
    const assignedRef: InboxItem = { id: 'r2', type: 'note', title: 'assigned ref', body: '', createdAt: '2026-01-04T00:00:00Z', collectionId: 'c1' } as any;
    // Inbox ref (no flag, no collection) — must stay in the Inbox, not leak.
    const inboxRef: InboxItem = { id: 'r3', type: 'note', title: 'inbox ref', body: '', createdAt: '2026-01-05T00:00:00Z' } as any;
    items.set({ t1: todo, r1: orphanRef, t2: assignedTodo, r2: assignedRef, r3: inboxRef });

    const byCollection = get(collectionItems);
    const uncatItems = byCollection[UNCATEGORIZED_COLLECTION_ID] ?? [];
    expect(uncatItems.map(i => i.id)).toEqual(['t1', 'r1']);
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

  it('drops ids that do not correspond to real groups', async () => {
    groups.set({ g1: makeGroup('g1') });

    await setActiveGroupFilters(['g1', 'g_unknown']);

    expect(get(appConfig).activeGroupFilters).toEqual(['g1']);
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

    const updatedCol = get(collections)['c1'];
    expect(updatedCol.groupId).toBe('g1');

    const updatedGroup = get(groups)['g1'];
    expect(updatedGroup.collectionIds).toContain('c1');
  });

  it('removes collection from old group when moving to new group', async () => {
    const col = makeCollection('c1', 'g1');
    const oldGroup = makeGroup('g1', ['c1']);
    const newGroup = makeGroup('g2', []);

    collections.set({ c1: col });
    groups.set({ g1: oldGroup, g2: newGroup });

    await moveCollectionToGroup('c1', 'g2');

    const updatedOldGroup = get(groups)['g1'];
    expect(updatedOldGroup.collectionIds).not.toContain('c1');

    const updatedNewGroup = get(groups)['g2'];
    expect(updatedNewGroup.collectionIds).toContain('c1');

    expect(get(collections)['c1'].groupId).toBe('g2');
  });

  it('throws without mutating when target group is missing', async () => {
    const col = makeCollection('c1', 'g1');
    const group = makeGroup('g1', ['c1']);

    collections.set({ c1: col });
    groups.set({ g1: group });

    await expect(moveCollectionToGroup('c1', 'missing')).rejects.toThrow('Cannot move collection to missing group');

    expect(get(collections)['c1'].groupId).toBe('g1');
    expect(get(groups)['g1'].collectionIds).toEqual(['c1']);
    expect(mockInbox.storeCollection).not.toHaveBeenCalled();
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
  });
});

describe('allTodos / openTodos', () => {
  beforeEach(() => {
    items.set({});
    appConfig.set({});
  });

  it('returns every todo-like item across collections and uncategorized', () => {
    items.set({
      a: makeTodo('a', { collectionId: 'c1' }),
      b: makeTodo('b'), // uncategorized
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

    const all = get(allTodos).map(t => t.id).sort();
    expect(all).toEqual(['a', 'b', 'c']);
  });

  it('openTodos excludes completed todos', () => {
    items.set({
      open: makeTodo('open'),
      done: makeTodo('done', { completed: true, completedAt: '2026-01-02T00:00:00.000Z' }),
    });

    expect(get(openTodos).map(t => t.id)).toEqual(['open']);
  });
});

describe('visibleTodos', () => {
  beforeEach(() => {
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('shows uncategorized todos by default (uncategorized filter on)', () => {
    items.set({
      u1: makeTodo('u1', { createdAt: '2026-01-01T00:00:00.000Z' }),
      u2: makeTodo('u2', { createdAt: '2026-01-02T00:00:00.000Z' }),
    });

    // Newest first as the fallback sort
    expect(get(visibleTodos).map(t => t.id)).toEqual(['u2', 'u1']);
  });

  it('hides uncategorized todos when the uncategorized filter is off', () => {
    items.set({
      u1: makeTodo('u1'),
      c1: makeTodo('c1', { collectionId: 'col1' }),
    });
    collections.set({ col1: makeCollection('col1', 'g1') });
    groups.set({ g1: makeGroup('g1', ['col1']) });
    appConfig.set({ uncategorizedFilterActive: false });

    expect(get(visibleTodos).map(t => t.id)).toEqual(['c1']);
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
    // activeGroupFilters = just g-active; uncategorized off so we don't mix
    // orphan behaviour into this assertion.
    appConfig.set({
      activeGroupFilters: ['g-active'],
      uncategorizedFilterActive: false,
    });

    expect(get(visibleTodos).map(t => t.id)).toEqual(['c1']);
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
      uncategorizedFilterActive: false,
    });

    expect(get(visibleTodos)).toEqual([]);
  });

  it('treats a todo whose collection was deleted as uncategorized for filtering purposes', () => {
    items.set({
      stale: makeTodo('stale', { collectionId: 'deleted' }),
    });
    collections.set({});
    appConfig.set({ uncategorizedFilterActive: true });

    expect(get(visibleTodos).map(t => t.id)).toEqual(['stale']);

    // And disappears when the uncategorized pill is off
    appConfig.set({ uncategorizedFilterActive: false });
    expect(get(visibleTodos)).toEqual([]);
  });

  it('respects persisted todosGlobalOrder and falls back to newest-first for missing ids', () => {
    items.set({
      t1: makeTodo('t1', { createdAt: '2026-01-01T00:00:00.000Z' }),
      t2: makeTodo('t2', { createdAt: '2026-01-02T00:00:00.000Z' }),
      t3: makeTodo('t3', { createdAt: '2026-01-03T00:00:00.000Z' }),
    });
    // Only t2 is in the persisted order; t1/t3 fall back to createdAt desc
    appConfig.set({ todosGlobalOrder: ['t2'] });

    expect(get(visibleTodos).map(t => t.id)).toEqual(['t2', 't3', 't1']);
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
      expect.objectContaining({ todosGlobalOrder: ['t2', 't1', 't3'] })
    );
  });

  it('overwrites a previous order', async () => {
    appConfig.set({ todosGlobalOrder: ['t1', 't2'] });

    await reorderTodosGlobal(['t2', 't1']);

    expect(get(appConfig).todosGlobalOrder).toEqual(['t2', 't1']);
  });
});

describe('uncategorizedFilterActive / toggleUncategorizedFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appConfig.set({});
  });

  it('defaults to true when the flag is unset', () => {
    expect(get(uncategorizedFilterActive)).toBe(true);
  });

  it('reflects the persisted flag when explicitly set', () => {
    appConfig.set({ uncategorizedFilterActive: false });
    expect(get(uncategorizedFilterActive)).toBe(false);

    appConfig.set({ uncategorizedFilterActive: true });
    expect(get(uncategorizedFilterActive)).toBe(true);
  });

  it('toggle flips from unset-default-true to explicit false', async () => {
    expect(get(uncategorizedFilterActive)).toBe(true);

    await toggleUncategorizedFilter();

    expect(get(uncategorizedFilterActive)).toBe(false);
    expect(get(appConfig).uncategorizedFilterActive).toBe(false);
  });

  it('toggle flips from false back to true', async () => {
    appConfig.set({ uncategorizedFilterActive: false });

    await toggleUncategorizedFilter();

    expect(get(uncategorizedFilterActive)).toBe(true);
    expect(get(appConfig).uncategorizedFilterActive).toBe(true);
  });
});

// ---- deleteCollection: must-be-empty guard ----
//
// Mirrors the deleteGroup rule so the UI can't silently dump filed items into
// the Uncategorized bucket on an accidental tap. Items are matched by their
// live `collectionId` rather than the collection's `itemIds` array (which can
// drift out of sync after partial writes).

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
      i1: { id: 'i1', type: 'note', title: 'kept', body: '', createdAt: '2026-01-01T00:00:00.000Z', collectionId: 'c1' } as InboxItem,
    });

    const ok = await deleteCollection('c1');

    expect(ok).toBe(false);
    expect(get(collections)['c1']).toBeDefined();
    expect(get(items)['i1'].collectionId).toBe('c1'); // item untouched
    expect(mockInbox.removeCollection).not.toHaveBeenCalled();
    expect(mockInbox.store).not.toHaveBeenCalled(); // no orphaning side effect
  });

  it('deletes an empty collection and removes it from collectionsOrder', async () => {
    collections.set({ c1: makeCollection('c1'), c2: makeCollection('c2') });
    appConfig.set({ collectionsOrder: ['c1', 'c2'] });

    const ok = await deleteCollection('c1');

    expect(ok).toBe(true);
    expect(get(collections)['c1']).toBeUndefined();
    expect(get(collections)['c2']).toBeDefined();
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
      i1: { id: 'i1', type: 'note', title: 'moved away', body: '', createdAt: '2026-01-01T00:00:00.000Z', collectionId: 'c2' } as InboxItem,
    });

    const ok = await deleteCollection('c1');

    expect(ok).toBe(true);
    expect(get(collections)['c1']).toBeUndefined();
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
    expect(get(collections)['c1'].groupId).toBe('g1');
    expect(get(groups)['g1'].collectionIds).toContain('c1');
    expect(get(groupCollections)['g1'].map(c => c.id)).toEqual(['c1']);
    // No new group was auto-created
    expect(Object.keys(get(groups))).toEqual(['g1']);
  });

  it('rejects collection creation without a real group', async () => {
    await expect(createCollection(makeCollection('c1'))).rejects.toThrow('Cannot create collection without a real group');
    expect(get(collections)['c1']).toBeUndefined();
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
  });

  it('rejects collection creation with a missing group', async () => {
    await expect(createCollection(makeCollection('c1', 'missing'))).rejects.toThrow('Cannot create collection without a real group');
    expect(get(collections)['c1']).toBeUndefined();
  });
});

describe('load-time collection group repair', () => {
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

  it('creates Uncategorized1 and moves loaded collections without a group into it', async () => {
    mockInbox.getAllCollections.mockResolvedValue({ c1: makeCollection('c1') });
    mockInbox.getAllGroups.mockResolvedValue({});

    await rsHandlers['connected']();

    const uncatGroup = Object.values(get(groups)).find((g) => g.name === 'Uncategorized1');
    expect(uncatGroup).toBeDefined();
    expect(get(collections)['c1'].groupId).toBe(uncatGroup!.id);
    expect(get(groups)[uncatGroup!.id].collectionIds).toContain('c1');
  });

  it('reuses the lowest existing Uncategorized<N> group during load repair', async () => {
    const u3 = makeGroup('g3'); u3.name = 'Uncategorized3';
    const u1 = makeGroup('g1'); u1.name = 'Uncategorized1';
    const u2 = makeGroup('g2'); u2.name = 'Uncategorized2';
    mockInbox.getAllCollections.mockResolvedValue({ c1: makeCollection('c1', 'deleted-group') });
    mockInbox.getAllGroups.mockResolvedValue({ g3: u3, g1: u1, g2: u2 });

    await rsHandlers['connected']();

    expect(get(collections)['c1'].groupId).toBe('g1');
    expect(get(groups)['g1'].collectionIds).toContain('c1');
    expect(Object.values(get(groups)).filter((g) => g.name === 'Uncategorized1')).toHaveLength(1);
  });

  it('does not repair when groups fail to load', async () => {
    const existing = makeGroup('g1', ['c1']);
    groups.set({ g1: existing });
    collections.set({ c1: makeCollection('c1', 'g1') });
    mockInbox.getAllCollections.mockResolvedValue({ c1: makeCollection('c1', 'g1') });
    mockInbox.getAllGroups.mockRejectedValue(new Error('temporary groups read failure'));

    await rsHandlers['connected']();

    expect(get(collections)['c1'].groupId).toBe('g1');
    expect(get(groups)['g1']).toBeDefined();
    expect(Object.values(get(groups)).some((g) => g.name === 'Uncategorized1')).toBe(false);
  });

  // Intentionally NOT auto-repaired: a 'groups/<id>' delete arriving via the
  // RS change handler can be a transient mid-sync state (e.g. a group write
  // hasn't landed yet on this device), and rewriting every dependent
  // collection's groupId is destructive and propagates to all devices. This
  // is exactly the v2.0.4 regression that wiped users' organization. Repair
  // only runs at load time, where we can assert both stores are populated
  // before deciding a collection is genuinely orphaned.
});
