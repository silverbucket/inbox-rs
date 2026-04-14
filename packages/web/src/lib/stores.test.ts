// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

// Mock the RS module to prevent RemoteStorage initialization side effects
const { mockFetchFileBlobUrl } = vi.hoisted(() => {
  const mockFetchFileBlobUrl = vi.fn();
  return { mockFetchFileBlobUrl };
});

vi.mock('./rs', () => {
  const rs = {
    access: { claim: vi.fn() },
    caching: { enable: vi.fn() },
    setSyncInterval: vi.fn(),
    on: vi.fn(),
    remote: {},
    startSync: vi.fn(),
    inbox: {
      getAll: vi.fn().mockResolvedValue({}),
      getConfig: vi.fn().mockResolvedValue({}),
      getAllCollections: vi.fn().mockResolvedValue({}),
      getAllGroups: vi.fn().mockResolvedValue({}),
      onChange: vi.fn(),
      store: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      storeCollection: vi.fn().mockResolvedValue(undefined),
      storeGroup: vi.fn().mockResolvedValue(undefined),
    },
  };
  return {
    default: rs,
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
} from './stores';
import type { Collection, CollectionGroup } from '@inbox-rs/rs-module';

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
