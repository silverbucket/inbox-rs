// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  deleteGroup, ungroupedCollections, appConfig,
  storeCollection, reorderGroupCollections, items, todoItems, reorderTodos,
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
const onChangeHandler = mockInbox.onChange.mock.calls[0]?.[0] as (() => void) | undefined;

/** Simulate a remoteStorage module change event (marks data as changed for sync-done reload) */
function emitModuleChange() {
  if (onChangeHandler) onChangeHandler();
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

    expect(mockFetchFileBlobUrl).toHaveBeenCalledWith('files/photo.jpg');
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

  it('keeps configured open todo order and falls back to newest-first for new todos', () => {
    items.set({
      t1: makeTodo('t1', { createdAt: '2026-01-01T00:00:00.000Z' }),
      t2: makeTodo('t2', { createdAt: '2026-01-02T00:00:00.000Z' }),
      t3: makeTodo('t3', { createdAt: '2026-01-03T00:00:00.000Z' }),
    });
    appConfig.set({ todosOrder: ['t2'] });

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

  it('persists reordered inbox todo ids in config', async () => {
    appConfig.set({});

    await reorderTodos(['t3', 't1', 't2']);

    expect(get(appConfig).todosOrder).toEqual(['t3', 't1', 't2']);
    expect(mockInbox.setConfig).toHaveBeenCalledWith({ todosOrder: ['t3', 't1', 't2'] });
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

describe('ungroupedCollections', () => {
  beforeEach(() => {
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('returns collections with no groupId', () => {
    const col1 = makeCollection('c1');
    const col2 = makeCollection('c2', 'g1');
    const group = makeGroup('g1', ['c2']);

    collections.set({ c1: col1, c2: col2 });
    groups.set({ g1: group });

    const result = get(ungroupedCollections);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  it('returns collections whose groupId points to a non-existent group', () => {
    const col = makeCollection('c1', 'g_deleted');

    collections.set({ c1: col });
    groups.set({});

    const result = get(ungroupedCollections);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  it('does not include collections with a valid groupId', () => {
    const col = makeCollection('c1', 'g1');
    const group = makeGroup('g1', ['c1']);

    collections.set({ c1: col });
    groups.set({ g1: group });

    const result = get(ungroupedCollections);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when all collections belong to groups', () => {
    const col1 = makeCollection('c1', 'g1');
    const col2 = makeCollection('c2', 'g1');
    const group = makeGroup('g1', ['c1', 'c2']);

    collections.set({ c1: col1, c2: col2 });
    groups.set({ g1: group });

    const result = get(ungroupedCollections);
    expect(result).toHaveLength(0);
  });
});

describe('no auto-group-creation on connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
    appConfig.set({});
    // Reset mock return values for loaders
    mockInbox.getAll.mockResolvedValue({});
    mockInbox.getConfig.mockResolvedValue({});
    mockInbox.getAllCollections.mockResolvedValue({});
    mockInbox.getAllGroups.mockResolvedValue({});
    mockInbox.getUserSettings.mockResolvedValue(undefined);
  });

  it('does not create a group when connecting with no groups', async () => {
    await rsHandlers['connected']();

    expect(get(groups)).toEqual({});
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
  });

  it('does not create a group when connecting with ungrouped collections', async () => {
    const col = makeCollection('c1');
    mockInbox.getAllCollections.mockResolvedValue({ c1: col });

    await rsHandlers['connected']();

    // Collections should load but no group should be created
    expect(get(collections)['c1']).toBeDefined();
    expect(Object.keys(get(groups))).toHaveLength(0);
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
  });

  it('does not force-migrate ungrouped collections into an existing group', async () => {
    const col = makeCollection('c1'); // no groupId
    const group = makeGroup('g1', []);
    mockInbox.getAllCollections.mockResolvedValue({ c1: col });
    mockInbox.getAllGroups.mockResolvedValue({ g1: group });

    await rsHandlers['connected']();

    // Collection should remain ungrouped
    expect(get(collections)['c1'].groupId).toBeUndefined();
    // storeCollection should not have been called to migrate
    expect(mockInbox.storeCollection).not.toHaveBeenCalled();
  });

  it('preserves existing groups on connect without modification', async () => {
    const group = makeGroup('g1', ['c1']);
    const col = makeCollection('c1', 'g1');
    mockInbox.getAllCollections.mockResolvedValue({ c1: col });
    mockInbox.getAllGroups.mockResolvedValue({ g1: group });

    await rsHandlers['connected']();

    expect(get(groups)['g1']).toBeDefined();
    expect(get(groups)['g1'].name).toBe('Group g1');
    // No new groups created, no groups modified
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
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

  it('does not recreate a group after all groups are deleted and a sync-done reload triggers', async () => {
    // Start with a group
    const group = makeGroup('g1', []);
    groups.set({ g1: group });

    // Delete the group
    await deleteGroup('g1');
    expect(get(groups)['g1']).toBeUndefined();

    // Simulate a sync-done event triggering a reload (backend returns empty)
    emitModuleChange();
    emitRsEvent('sync-done');
    await vi.waitFor(() => {
      expect(Object.keys(get(groups))).toHaveLength(0);
    }, { timeout: 500 });

    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
  });
});

describe('sync-done reload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
    mockInbox.getAll.mockResolvedValue({});
    mockInbox.getAllCollections.mockResolvedValue({});
    mockInbox.getAllGroups.mockResolvedValue({});
  });

  it('does not reload on idle sync-done when no data changed', async () => {
    // Drain any stale syncHasChanges flag from prior tests
    emitRsEvent('sync-done');
    await new Promise(r => setTimeout(r, 200));
    vi.clearAllMocks();
    mockInbox.getAll.mockResolvedValue({});
    mockInbox.getAllCollections.mockResolvedValue({});
    mockInbox.getAllGroups.mockResolvedValue({});

    // Now fire sync-done with no preceding onChange — should not reload
    emitRsEvent('sync-done');
    await new Promise(r => setTimeout(r, 200));
    expect(mockInbox.getAll).not.toHaveBeenCalled();
  });

  it('reloads items, collections, and groups on sync-done after changes', async () => {
    const item = { id: 'i1', type: 'note', title: 'Test', createdAt: '2026-01-01T00:00:00.000Z' };
    const col = makeCollection('c1');
    const group = makeGroup('g1', ['c1']);
    mockInbox.getAll.mockResolvedValue({ i1: item });
    mockInbox.getAllCollections.mockResolvedValue({ c1: col });
    mockInbox.getAllGroups.mockResolvedValue({ g1: group });

    expect(Object.keys(get(items))).toHaveLength(0);

    // onChange marks data as changed, sync-done triggers the reload
    emitModuleChange();
    emitRsEvent('sync-done');

    await vi.waitFor(() => {
      expect(Object.keys(get(items))).toHaveLength(1);
      expect(get(items)['i1'].title).toBe('Test');
      expect(get(collections)['c1']).toBeDefined();
      expect(get(groups)['g1']).toBeDefined();
    }, { timeout: 500 });
  });

  it('reloads only once for rapid sync-done events (debounce)', async () => {
    mockInbox.getAll.mockResolvedValue({});
    mockInbox.getAllCollections.mockResolvedValue({});
    mockInbox.getAllGroups.mockResolvedValue({});

    // Mark data as changed, then fire sync-done 5 times rapidly
    emitModuleChange();
    for (let i = 0; i < 5; i++) {
      emitRsEvent('sync-done');
    }

    await vi.waitFor(() => {
      expect(mockInbox.getAll).toHaveBeenCalled();
    }, { timeout: 500 });

    // Debounce (100ms) should collapse these into a single reload
    expect(mockInbox.getAll).toHaveBeenCalledTimes(1);
  });

  it('picks up new incoming items after sync completes', async () => {
    items.set({ i1: { id: 'i1', type: 'note', title: 'Old', createdAt: '2026-01-01T00:00:00.000Z' } as InboxItem });

    mockInbox.getAll.mockResolvedValue({
      i1: { id: 'i1', type: 'note', title: 'Old', createdAt: '2026-01-01T00:00:00.000Z' },
      i2: { id: 'i2', type: 'image', title: 'Photo', createdAt: '2026-01-02T00:00:00.000Z', filePath: 'files/photo.jpg', mimeType: 'image/jpeg' },
    });

    emitModuleChange();
    emitRsEvent('sync-done');

    await vi.waitFor(() => {
      expect(Object.keys(get(items))).toHaveLength(2);
      expect(get(items)['i2'].title).toBe('Photo');
    }, { timeout: 500 });
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

describe('ungroupedCollections reacts to group deletion', () => {
  beforeEach(() => {
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('collections appear in ungroupedCollections after their group is deleted', async () => {
    const col = makeCollection('c1', 'g1');
    const group = makeGroup('g1', ['c1']);

    collections.set({ c1: col });
    groups.set({ g1: group });

    // Before deletion: c1 is grouped
    expect(get(ungroupedCollections)).toHaveLength(0);
    expect(get(groupCollections)['g1']).toHaveLength(1);

    // Simulate the group being removed from the store (as if deleted on another device)
    groups.update(current => {
      const next = { ...current };
      delete next['g1'];
      return next;
    });

    // c1 still has groupId 'g1' but that group no longer exists
    expect(get(ungroupedCollections)).toHaveLength(1);
    expect(get(ungroupedCollections)[0].id).toBe('c1');
  });

  it('collections move from ungrouped to grouped when assigned a valid group', async () => {
    const col = makeCollection('c1');
    const group = makeGroup('g1', []);

    collections.set({ c1: col });
    groups.set({ g1: group });

    // Before: ungrouped
    expect(get(ungroupedCollections)).toHaveLength(1);

    await moveCollectionToGroup('c1', 'g1');

    // After: grouped
    expect(get(ungroupedCollections)).toHaveLength(0);
    expect(get(groupCollections)['g1']).toHaveLength(1);
  });
});

// ---- Tests exercising the component code paths for the ungrouped route ----
// These mirror what CollectionsPage and App.svelte do when groupId is "" or undefined.

describe('ungrouped route: collection creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('collection created without groupId stays ungrouped', async () => {
    // App.svelte passes groupId=undefined to CollectionFormModal on the ungrouped route.
    // CollectionFormModal sets groupId to undefined, so handleCreateCollection
    // calls storeCollection but skips moveCollectionToGroup.
    const col = makeCollection('c1'); // no groupId — mirrors what CollectionFormModal produces

    await storeCollection(col);
    // App.svelte: if (col.groupId) { await moveCollectionToGroup(...) }
    // groupId is undefined so this branch is skipped.

    expect(get(collections)['c1']).toBeDefined();
    expect(get(collections)['c1'].groupId).toBeUndefined();
    expect(get(ungroupedCollections)).toHaveLength(1);
    expect(mockInbox.storeGroup).not.toHaveBeenCalled();
  });

  it('collection created with empty-string groupId is treated as ungrouped', async () => {
    // Edge case: if groupId were "" instead of undefined
    const col: Collection = {
      id: 'c1',
      name: 'Test',
      itemIds: [],
      createdAt: new Date().toISOString(),
      groupId: '',
    };

    await storeCollection(col);
    // "" is falsy so moveCollectionToGroup would be skipped in handleCreateCollection

    expect(get(collections)['c1'].groupId).toBe('');
    // ungroupedCollections checks !c.groupId — empty string is falsy, so it's included
    expect(get(ungroupedCollections)).toHaveLength(1);
  });
});

describe('ungrouped route: reorder is a no-op', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collections.set({});
    groups.set({});
    appConfig.set({});
  });

  it('reorderGroupCollections with empty groupId does not modify any group', async () => {
    // CollectionsPage calls reorderGroupCollections(groupId, newIds) on DnD finalize.
    // When groupId is "", no group matches, so it should be a no-op.
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
});
