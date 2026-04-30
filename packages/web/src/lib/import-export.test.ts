// @vitest-environment jsdom

import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInbox = vi.hoisted(() => ({
  getAll: vi.fn().mockResolvedValue({}),
  getAllCollections: vi.fn().mockResolvedValue({}),
  getAllGroups: vi.fn().mockResolvedValue({}),
  getConfig: vi.fn().mockResolvedValue({}),
  getUserSettings: vi.fn().mockResolvedValue({}),
  getFile: vi.fn().mockResolvedValue(undefined),
  store: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  storeCollection: vi.fn().mockResolvedValue(undefined),
  removeCollection: vi.fn().mockResolvedValue(undefined),
  storeGroup: vi.fn().mockResolvedValue(undefined),
  removeGroup: vi.fn().mockResolvedValue(undefined),
  setConfig: vi.fn().mockResolvedValue(undefined),
  setUserSettings: vi.fn().mockResolvedValue(undefined),
  onChange: vi.fn(),
}));

// Capture what zipSync receives and control what unzipSync returns
const { mockZipSync, mockUnzipSync } = vi.hoisted(() => {
  const mockZipSync = vi.fn();
  const mockUnzipSync = vi.fn();
  return { mockZipSync, mockUnzipSync };
});

vi.mock('fflate', () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
    zipSync: mockZipSync,
    unzipSync: mockUnzipSync,
    strToU8: (s: string) => encoder.encode(s),
    strFromU8: (b: Uint8Array) => decoder.decode(b),
  };
});

vi.mock('./rs', () => {
  const rs = {
    access: { claim: vi.fn() },
    caching: { enable: vi.fn() },
    setSyncInterval: vi.fn(),
    on: vi.fn(),
    remote: {},
    startSync: vi.fn(),
    inbox: mockInbox,
  };
  return {
    default: rs,
    fetchFileBlobUrl: vi.fn(),
    fetchFileWithAuth: vi.fn(),
  };
});

vi.mock('./clean-for-storage', () => ({
  cleanForStorage: (x: any) => x,
}));

import type {
  Collection,
  CollectionGroup,
  InboxItem,
} from '@inbox-rs/rs-module';
import type { ExportManifest } from './import-export';
import { exportToZipBytes, importFromZipBytes } from './import-export';
import { appConfig, collections, groups, items, userSettings } from './stores';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeNote(id: string, title: string): InboxItem {
  return {
    id,
    type: 'note',
    title,
    body: 'test',
    createdAt: '2026-01-01T00:00:00Z',
  } as InboxItem;
}

function makeImage(id: string, title: string): InboxItem {
  return {
    id,
    type: 'image',
    title,
    filePath: `images/${id}.jpg`,
    mimeType: 'image/jpeg',
    createdAt: '2026-01-01T00:00:00Z',
  } as InboxItem;
}

function makeCollection(id: string, name: string): Collection {
  return { id, name, itemIds: [], createdAt: '2026-01-01T00:00:00Z' };
}

function makeGroup(id: string, name: string): CollectionGroup {
  return { id, name, collectionIds: [], createdAt: '2026-01-01T00:00:00Z' };
}

function makeUnzipResult(
  manifest: ExportManifest,
  binaryFiles?: Record<string, Uint8Array>,
): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = {};
  result['manifest.json'] = encoder.encode(JSON.stringify(manifest));
  if (binaryFiles) {
    for (const [path, data] of Object.entries(binaryFiles)) {
      result[path] = data;
    }
  }
  return result;
}

describe('exportToZipBytes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
    userSettings.set({});
    mockZipSync.mockReturnValue(new Uint8Array([1, 2, 3]));
  });

  it('exports items, collections, groups, config, and settings', async () => {
    const testItems = { n1: makeNote('n1', 'Note 1') };
    const testCollections = { c1: makeCollection('c1', 'Col 1') };
    const testGroups = { g1: makeGroup('g1', 'Group 1') };
    const testConfig = { todosCollapsed: true };
    const testSettings = { theme: 'dark' as const };

    mockInbox.getAll.mockResolvedValue(testItems);
    mockInbox.getAllCollections.mockResolvedValue(testCollections);
    mockInbox.getAllGroups.mockResolvedValue(testGroups);
    mockInbox.getConfig.mockResolvedValue(testConfig);
    mockInbox.getUserSettings.mockResolvedValue(testSettings);

    await exportToZipBytes();

    expect(mockZipSync).toHaveBeenCalledTimes(1);
    const zipInput = mockZipSync.mock.calls[0][0];

    // Parse the manifest that was passed to zipSync
    const manifest: ExportManifest = JSON.parse(
      decoder.decode(zipInput['manifest.json']),
    );
    expect(manifest.version).toBe(1);
    expect(manifest.exportedAt).toBeTruthy();
    expect(manifest.items).toEqual(testItems);
    expect(manifest.collections).toEqual(testCollections);
    expect(manifest.groups).toEqual(testGroups);
    expect(manifest.appConfig).toEqual(testConfig);
    expect(manifest.userSettings).toEqual(testSettings);
  });

  it('includes binary files for items with filePath', async () => {
    const img = makeImage('img1', 'Photo');
    mockInbox.getAll.mockResolvedValue({ img1: img });
    mockInbox.getAllCollections.mockResolvedValue({});
    mockInbox.getAllGroups.mockResolvedValue({});
    mockInbox.getConfig.mockResolvedValue({});
    mockInbox.getUserSettings.mockResolvedValue({});

    const fileData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    mockInbox.getFile.mockResolvedValue({
      data: fileData.buffer,
      mimeType: 'image/jpeg',
    });

    await exportToZipBytes();

    const zipInput = mockZipSync.mock.calls[0][0];
    expect(zipInput['files/images/img1.jpg']).toBeDefined();
    expect(Array.from(zipInput['files/images/img1.jpg'])).toEqual([
      0xff, 0xd8, 0xff, 0xe0,
    ]);

    const manifest: ExportManifest = JSON.parse(
      decoder.decode(zipInput['manifest.json']),
    );
    expect(manifest.files['images/img1.jpg']).toEqual({
      mimeType: 'image/jpeg',
    });
  });

  it('fails when a file cannot be retrieved', async () => {
    const img = makeImage('img1', 'Missing');
    mockInbox.getAll.mockResolvedValue({ img1: img });
    mockInbox.getAllCollections.mockResolvedValue({});
    mockInbox.getAllGroups.mockResolvedValue({});
    mockInbox.getConfig.mockResolvedValue({});
    mockInbox.getUserSettings.mockResolvedValue({});
    mockInbox.getFile.mockResolvedValue(undefined);

    await expect(exportToZipBytes()).rejects.toThrow('could not be retrieved');
  });

  it('fails when a file fetch throws', async () => {
    const img = makeImage('img1', 'Error');
    mockInbox.getAll.mockResolvedValue({ img1: img });
    mockInbox.getAllCollections.mockResolvedValue({});
    mockInbox.getAllGroups.mockResolvedValue({});
    mockInbox.getConfig.mockResolvedValue({});
    mockInbox.getUserSettings.mockResolvedValue({});
    mockInbox.getFile.mockRejectedValue(new Error('network error'));

    await expect(exportToZipBytes()).rejects.toThrow('images/img1.jpg');
  });

  it('calls onProgress callback', async () => {
    mockInbox.getAll.mockResolvedValue({ n1: makeNote('n1', 'Note') });
    mockInbox.getAllCollections.mockResolvedValue({});
    mockInbox.getAllGroups.mockResolvedValue({});
    mockInbox.getConfig.mockResolvedValue({});
    mockInbox.getUserSettings.mockResolvedValue({});

    const progress = vi.fn();
    await exportToZipBytes(progress);

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'metadata' }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'zipping' }),
    );
  });
});

describe('importFromZipBytes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
    userSettings.set({});

    // After import, these are called to reload stores
    mockInbox.getAll.mockResolvedValue({});
    mockInbox.getAllCollections.mockResolvedValue({});
    mockInbox.getAllGroups.mockResolvedValue({});
    mockInbox.getConfig.mockResolvedValue({});
    mockInbox.getUserSettings.mockResolvedValue({});
  });

  it('restores all data from a valid ZIP', async () => {
    const manifest: ExportManifest = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      items: { n1: makeNote('n1', 'Imported Note') },
      collections: { c1: makeCollection('c1', 'Imported Col') },
      groups: { g1: makeGroup('g1', 'Imported Group') },
      appConfig: { todosCollapsed: false },
      userSettings: { theme: 'light' },
      files: {},
    };

    mockUnzipSync.mockReturnValue(makeUnzipResult(manifest));

    // Mock reload after import
    mockInbox.getAll.mockResolvedValue(manifest.items);
    mockInbox.getAllCollections.mockResolvedValue(manifest.collections);
    mockInbox.getAllGroups.mockResolvedValue(manifest.groups);
    mockInbox.getConfig.mockResolvedValue(manifest.appConfig);
    mockInbox.getUserSettings.mockResolvedValue(manifest.userSettings);

    await importFromZipBytes(new Uint8Array([1, 2, 3]));

    expect(mockInbox.storeGroup).toHaveBeenCalledWith(manifest.groups.g1);
    expect(mockInbox.storeCollection).toHaveBeenCalledWith(
      manifest.collections.c1,
    );
    expect(mockInbox.store).toHaveBeenCalledWith(manifest.items.n1, undefined);
    expect(mockInbox.setConfig).toHaveBeenCalledWith(manifest.appConfig);
    expect(mockInbox.setUserSettings).toHaveBeenCalledWith(
      manifest.userSettings,
    );

    expect(get(items)).toEqual(manifest.items);
    expect(get(collections)).toEqual(manifest.collections);
    expect(get(groups)).toEqual(manifest.groups);
  });

  it('restores binary files via store(item, fileData)', async () => {
    const img = makeImage('img1', 'Photo');
    const fileBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const manifest: ExportManifest = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      items: { img1: img },
      collections: {},
      groups: {},
      appConfig: {},
      userSettings: {},
      files: { 'images/img1.jpg': { mimeType: 'image/jpeg' } },
    };

    mockUnzipSync.mockReturnValue(
      makeUnzipResult(manifest, { 'files/images/img1.jpg': fileBytes }),
    );

    await importFromZipBytes(new Uint8Array([1, 2, 3]));

    expect(mockInbox.store).toHaveBeenCalledTimes(1);
    const [storedItem, storedFileData] = mockInbox.store.mock.calls[0];
    expect(storedItem.id).toBe('img1');
    expect(storedFileData).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(storedFileData))).toEqual([
      0xff, 0xd8, 0xff, 0xe0,
    ]);
  });

  it('clears existing data before restoring', async () => {
    items.set({ old1: makeNote('old1', 'Old') });
    collections.set({ oldc: makeCollection('oldc', 'Old Col') });
    groups.set({ oldg: makeGroup('oldg', 'Old Group') });

    const manifest: ExportManifest = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      items: {},
      collections: {},
      groups: {},
      appConfig: {},
      userSettings: {},
      files: {},
    };

    mockUnzipSync.mockReturnValue(makeUnzipResult(manifest));

    await importFromZipBytes(new Uint8Array([1, 2, 3]));

    expect(mockInbox.remove).toHaveBeenCalledWith(
      'old1',
      expect.objectContaining({ id: 'old1' }),
    );
    expect(mockInbox.removeCollection).toHaveBeenCalledWith('oldc');
    expect(mockInbox.removeGroup).toHaveBeenCalledWith('oldg');
  });

  it('rejects ZIP without manifest.json', async () => {
    mockUnzipSync.mockReturnValue({ 'other.txt': encoder.encode('hello') });

    await expect(importFromZipBytes(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      'missing manifest.json',
    );
  });

  it('rejects manifest with wrong version', async () => {
    const manifest = {
      version: 99,
      exportedAt: '2026-01-01T00:00:00Z',
      items: {},
      collections: {},
      groups: {},
      appConfig: {},
      userSettings: {},
      files: {},
    };

    mockUnzipSync.mockReturnValue(makeUnzipResult(manifest as any));

    await expect(importFromZipBytes(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      'Unsupported export version',
    );
  });

  it('calls onProgress callback during restore', async () => {
    const manifest: ExportManifest = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      items: { n1: makeNote('n1', 'Note') },
      collections: {},
      groups: {},
      appConfig: {},
      userSettings: {},
      files: {},
    };

    mockUnzipSync.mockReturnValue(makeUnzipResult(manifest));

    const progress = vi.fn();
    await importFromZipBytes(new Uint8Array([1, 2, 3]), progress);

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'reading' }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'restoring' }),
    );
  });

  it('clears config and settings when archive has empty objects', async () => {
    const manifest: ExportManifest = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      items: {},
      collections: {},
      groups: {},
      appConfig: {},
      userSettings: {},
      files: {},
    };

    mockUnzipSync.mockReturnValue(makeUnzipResult(manifest));

    await importFromZipBytes(new Uint8Array([1, 2, 3]));

    expect(mockInbox.setConfig).toHaveBeenCalledWith({});
    expect(mockInbox.setUserSettings).toHaveBeenCalledWith({});
  });
});

describe('round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items.set({});
    collections.set({});
    groups.set({});
    appConfig.set({});
    userSettings.set({});
  });

  it('export captures all data types and import restores them', async () => {
    const testItems = {
      n1: makeNote('n1', 'My Note'),
      img1: makeImage('img1', 'My Photo'),
    };
    const testCollections = {
      c1: { ...makeCollection('c1', 'Work'), itemIds: ['n1'] },
    };
    const testGroups = {
      g1: { ...makeGroup('g1', 'Projects'), collectionIds: ['c1'] },
    };
    const testConfig = { todosCollapsed: true, collectionsOrder: ['c1'] };
    const testSettings = { theme: 'dark' as const, abbreviation: 'NJ' };
    const fileBytes = new Uint8Array([1, 2, 3, 4, 5]);

    mockInbox.getAll.mockResolvedValue(testItems);
    mockInbox.getAllCollections.mockResolvedValue(testCollections);
    mockInbox.getAllGroups.mockResolvedValue(testGroups);
    mockInbox.getConfig.mockResolvedValue(testConfig);
    mockInbox.getUserSettings.mockResolvedValue(testSettings);
    mockInbox.getFile.mockResolvedValue({
      data: fileBytes.buffer,
      mimeType: 'image/jpeg',
    });

    // Capture what gets zipped during export
    let capturedZipInput: Record<string, Uint8Array> = {};
    mockZipSync.mockImplementation((data: Record<string, Uint8Array>) => {
      capturedZipInput = { ...data };
      return new Uint8Array([1, 2, 3]);
    });

    await exportToZipBytes();

    // Verify export captured the right data
    const exportedManifest: ExportManifest = JSON.parse(
      decoder.decode(capturedZipInput['manifest.json']),
    );
    expect(exportedManifest.items).toEqual(testItems);
    expect(exportedManifest.collections).toEqual(testCollections);
    expect(exportedManifest.groups).toEqual(testGroups);
    expect(exportedManifest.appConfig).toEqual(testConfig);
    expect(exportedManifest.userSettings).toEqual(testSettings);
    expect(capturedZipInput['files/images/img1.jpg']).toBeDefined();
    expect(Array.from(capturedZipInput['files/images/img1.jpg'])).toEqual([
      1, 2, 3, 4, 5,
    ]);

    // Now simulate import with the same manifest
    vi.clearAllMocks();
    items.set({});
    collections.set({});
    groups.set({});

    mockUnzipSync.mockReturnValue(capturedZipInput);
    mockInbox.getAll.mockResolvedValue(testItems);
    mockInbox.getAllCollections.mockResolvedValue(testCollections);
    mockInbox.getAllGroups.mockResolvedValue(testGroups);
    mockInbox.getConfig.mockResolvedValue(testConfig);
    mockInbox.getUserSettings.mockResolvedValue(testSettings);

    await importFromZipBytes(new Uint8Array([1, 2, 3]));

    // Verify all entities were stored
    expect(mockInbox.storeGroup).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'g1', name: 'Projects' }),
    );
    expect(mockInbox.storeCollection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', name: 'Work' }),
    );
    expect(mockInbox.store).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'n1', title: 'My Note' }),
      undefined,
    );
    // Image item should have binary data
    const imgCall = mockInbox.store.mock.calls.find(
      (c: any[]) => c[0].id === 'img1',
    );
    expect(imgCall).toBeDefined();
    expect(imgCall?.[1]).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(imgCall?.[1]))).toEqual([1, 2, 3, 4, 5]);

    expect(mockInbox.setConfig).toHaveBeenCalledWith(testConfig);
    expect(mockInbox.setUserSettings).toHaveBeenCalledWith(testSettings);

    // Verify stores were reloaded
    expect(get(items)).toEqual(testItems);
    expect(get(collections)).toEqual(testCollections);
    expect(get(groups)).toEqual(testGroups);
    expect(get(appConfig)).toEqual(testConfig);
    expect(get(userSettings)).toEqual(testSettings);
  });
});
