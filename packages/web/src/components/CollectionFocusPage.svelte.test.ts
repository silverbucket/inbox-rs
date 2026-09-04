// @vitest-environment jsdom

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubMatchMedia } from '../test/filing-drag-helpers';

const { collection } = vi.hoisted(() => ({
  collection: {
    id: 'col-1',
    name: 'Reading',
    color: '#6366f1',
    groupId: 'group-1',
    itemIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
}));

vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    collections: writable({ [collection.id]: collection }),
    groups: writable({
      'group-1': {
        id: 'group-1',
        name: 'Personal',
        collectionIds: [collection.id],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    }),
    collectionItems: writable({ [collection.id]: [] }),
    sortedGroups: writable([]),
    appConfig: writable({}),
    deleteCollection: vi.fn(),
    deleteItem: vi.fn(),
    moveCollectionToGroup: vi.fn(),
    moveItemToCollection: vi.fn(),
    reorderCollectionItems: vi.fn(),
    setCollectionArchived: vi.fn(),
    storeCollection: vi.fn(),
    updateConfig: vi.fn(),
  };
});

import CollectionFocusPage from './CollectionFocusPage.svelte';

describe('CollectionFocusPage scrolling', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    stubMatchMedia();
    Element.prototype.animate = vi.fn(() => ({
      cancel: vi.fn(),
      currentTime: 0,
      finished: Promise.resolve(),
      onfinish: null,
      pause: vi.fn(),
      play: vi.fn(),
    })) as unknown as typeof Element.prototype.animate;
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  it('puts the collection in a dedicated constrained scrollport', () => {
    component = mount(CollectionFocusPage, {
      target: host,
      props: {
        collectionId: collection.id,
        onselect: vi.fn(),
        onexit: vi.fn(),
      },
    });
    flushSync();

    const scrollRegion = host.querySelector('.focus-scroll') as HTMLElement;
    expect(scrollRegion).toBeTruthy();
    const styles = getComputedStyle(scrollRegion);
    expect(styles.minHeight).toBe('0px');
    expect(styles.overflowY).toBe('auto');
    expect(scrollRegion.querySelector('.collection')).toBeTruthy();
  });
});
