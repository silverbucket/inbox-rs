// @vitest-environment jsdom

import type { Collection, CollectionGroup } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchDndFinalize,
  stubMatchMedia,
} from '../test/filing-drag-helpers';

const fixtures = vi.hoisted(() => {
  const g1: CollectionGroup = {
    id: 'g1',
    name: 'Alpha',
    color: '#6366f1',
    collectionIds: ['c1', 'c2'],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const g2: CollectionGroup = {
    id: 'g2',
    name: 'Beta',
    color: '#22c55e',
    collectionIds: ['c3'],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const c1: Collection = {
    id: 'c1',
    name: 'One',
    color: '#6366f1',
    groupId: 'g1',
    itemIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const c2: Collection = {
    id: 'c2',
    name: 'Two',
    color: '#818cf8',
    groupId: 'g1',
    itemIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const c3: Collection = {
    id: 'c3',
    name: 'Three',
    color: '#22c55e',
    groupId: 'g2',
    itemIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  return { g1, g2, c1, c2, c3 };
});

const storeFns = vi.hoisted(() => ({
  reorderGroups: vi.fn().mockResolvedValue(undefined),
  reorderGroupCollections: vi.fn().mockResolvedValue(undefined),
  moveItemToCollection: vi.fn().mockResolvedValue(undefined),
  toggleCollectionFilter: vi.fn().mockResolvedValue(undefined),
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

import SidebarShellTestHost from '../test/SidebarShell.test-host.svelte';

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

  const navToCollection = vi.fn();

  function render() {
    component = mount(SidebarShellTestHost, {
      target: host,
      props: {
        route: { page: 'inbox' },
        navTo: vi.fn(),
        navToCollection,
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
    expect(host.querySelectorAll('.group-row .reorder-grip').length).toBe(2);
    expect(
      host.querySelectorAll('.collection-drag-row .reorder-grip').length,
    ).toBe(3);
  });

  /**
   * The row body carries the sidebar's two most-used collection controls —
   * the dot toggles the show/hide filter, the name opens focus mode. A
   * native drag source suppresses the click once the pointer travels a few
   * pixels, so nothing on the row body may be `draggable`.
   */
  it('leaves the collection row body clickable, not draggable', () => {
    render();
    const entity = host.querySelector('.collection-entity') as HTMLElement;
    expect(entity.getAttribute('draggable')).toBeNull();
    expect(entity.draggable).toBe(false);

    entity.click();
    expect(navToCollection).toHaveBeenCalledWith('c1');

    const dot = host.querySelector('.dot-toggle') as HTMLElement;
    expect(dot.draggable).toBe(false);
    dot.click();
    expect(storeFns.toggleCollectionFilter).toHaveBeenCalledWith('c1');
  });

  it('starts the move-to-group drag from the move button', () => {
    render();
    const move = host.querySelector('.collection-move-btn') as HTMLElement;
    expect(move.draggable).toBe(true);
    expect(move.getAttribute('aria-label')).toBe('Move One to another group');
  });

  /**
   * The menu used to be hoisted out of the drag zone into a second loop, which
   * rendered it below the *last* collection in the group — 114px from the row
   * whose button opened it, and further with every collection added.
   */
  it('renders the move menu inside the row whose button opened it', async () => {
    render();
    const row = host.querySelector('.collection-drag-row') as HTMLElement;
    (row.querySelector('.collection-move-btn') as HTMLElement).click();
    flushSync();

    const menu = host.querySelector('.collection-move-menu');
    expect(menu).toBeTruthy();
    expect(row.contains(menu)).toBe(true);
  });

  /**
   * `dragDisabled` lives in a module-global store inside svelte-dnd-action, so
   * a value set here would be overwritten by any other zone on the page — the
   * Collections page renders inside this shell. Reorder is handle-driven, so
   * the flag isn't needed; `zoneTabIndex` keeps the containers out of the tab
   * order instead of leaving empty stops behind.
   */
  it('leaves reorder enabled and keeps zone containers out of the tab order', () => {
    render();
    const zones = host.querySelectorAll<HTMLElement>(
      '.groups-dnd, .collections-dnd',
    );
    expect(zones.length).toBeGreaterThan(0);
    for (const zone of zones) expect(zone.tabIndex).toBe(-1);

    // `dragHandle` parks an enabled grip at tabindex 0; a `dragDisabled` zone
    // anywhere on the page would drive every grip to -1 through the library's
    // module-global store.
    for (const grip of host.querySelectorAll<HTMLElement>('.reorder-grip')) {
      expect(grip.tabIndex).toBe(0);
    }
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
