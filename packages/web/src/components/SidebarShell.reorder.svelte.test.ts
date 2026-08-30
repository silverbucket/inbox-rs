// @vitest-environment jsdom

import type { Collection, CollectionGroup } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchDndFinalize,
  stubMatchMedia,
} from '../lib/filing-drag-helpers';

const fixtures = vi.hoisted(() => {
  const g1: CollectionGroup = {
    id: 'g1',
    name: 'Alpha',
    color: '#6366f1',
    collectionIds: ['c1', 'c2'],
  };
  const g2: CollectionGroup = {
    id: 'g2',
    name: 'Beta',
    color: '#22c55e',
    collectionIds: ['c3'],
  };
  const c1: Collection = {
    id: 'c1',
    name: 'One',
    color: '#6366f1',
    groupId: 'g1',
    itemIds: [],
  };
  const c2: Collection = {
    id: 'c2',
    name: 'Two',
    color: '#818cf8',
    groupId: 'g1',
    itemIds: [],
  };
  const c3: Collection = {
    id: 'c3',
    name: 'Three',
    color: '#22c55e',
    groupId: 'g2',
    itemIds: [],
  };
  return { g1, g2, c1, c2, c3 };
});

const storeFns = vi.hoisted(() => ({
  reorderGroups: vi.fn().mockResolvedValue(undefined),
  reorderGroupCollections: vi.fn().mockResolvedValue(undefined),
  moveItemToCollection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/stores', async () => {
  const { writable: w } = await import('svelte/store');
  const { g1, g2, c1, c2, c3 } = fixtures;
  return {
    sortedGroups: w([g1, g2]),
    groupCollections: w({
      g1: [c1, c2],
      g2: [c3],
    }),
    activeGroupIds: w(new Set(['g1', 'g2'])),
    inactiveCollectionIds: w(new Set<string>()),
    toggleGroupFilter: vi.fn(),
    soloGroupFilter: vi.fn(),
    toggleCollectionFilter: vi.fn(),
    enableCollectionFilter: vi.fn(),
    soloCollectionFilter: vi.fn(),
    moveCollectionToGroup: vi.fn(),
    createCollection: vi.fn(),
    storeGroup: vi.fn(),
    items: w({}),
    ...storeFns,
  };
});

vi.mock('../lib/toast', () => ({ showToast: vi.fn() }));
vi.mock('./UserMenu.svelte', () => import('./__mocks__/UserMenuStub.svelte'));

import SidebarShellTestHost from './SidebarShell.test-host.svelte';

describe('SidebarShell drag reorder', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    stubMatchMedia();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  function render() {
    component = mount(SidebarShellTestHost, {
      target: host,
      props: {
        route: { page: 'inbox' },
        navTo: vi.fn(),
        viewTodoCount: 0,
        totalTodoCount: 0,
        onaddgroup: vi.fn(),
      },
    });
    flushSync();
    for (const btn of host.querySelectorAll<HTMLButtonElement>(
      '.group-row .chevron:not([disabled])',
    )) {
      if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
    }
    flushSync();
  }

  it('exposes grip handles for reordering groups and collections', () => {
    render();
    expect(host.querySelectorAll('.group-reorder-handle').length).toBe(2);
    expect(host.querySelectorAll('.collection-reorder-handle').length).toBe(3);
  });

  it('persists group reorder when the sidebar groups zone finalizes', async () => {
    render();
    const zone = host.querySelector('.groups-dnd') as HTMLElement;
    dispatchDndFinalize(zone, [fixtures.g2, fixtures.g1]);
    await vi.waitFor(() => {
      expect(storeFns.reorderGroups).toHaveBeenCalledWith(['g2', 'g1']);
    });
  });

  it('persists collection reorder within a group when the zone finalizes', async () => {
    render();
    const zone = host.querySelector('.collections-dnd') as HTMLElement;
    expect(zone).toBeTruthy();
    dispatchDndFinalize(zone, [fixtures.c2, fixtures.c1]);
    await vi.waitFor(() => {
      expect(storeFns.reorderGroupCollections).toHaveBeenCalledWith('g1', [
        'c2',
        'c1',
      ]);
    });
  });
});
