// @vitest-environment jsdom
import type { Collection, CollectionGroup } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import type { Writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    favoriteCollections: (await import('svelte/store')).writable([]),
    favoriteCollectionIds: (await import('svelte/store')).writable([]),
    toggleFavoriteCollection: vi.fn().mockResolvedValue(undefined),
    setItemPlan: vi.fn().mockResolvedValue(undefined),
    appConfig: writable({}),
    createCollection: vi.fn().mockResolvedValue(undefined),
    groupCollections: writable({}),
    groups: writable({}),
    items: writable({}),
    orphanCollections: writable([]),
    sortedGroups: writable([]),
    storeGroup: vi.fn().mockResolvedValue(undefined),
    updateConfig: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  createCollection,
  favoriteCollections,
  groupCollections,
  groups,
  sortedGroups,
  storeGroup,
} from '../lib/stores';
import CollectionPicker from './CollectionPicker.svelte';

const writableStore = <T>(store: unknown) => store as Writable<T>;

describe('CollectionPicker', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    writableStore<Record<string, CollectionGroup>>(groups).set({});
    writableStore<CollectionGroup[]>(sortedGroups).set([]);
    writableStore<Record<string, Collection[]>>(groupCollections).set({});
    writableStore<Collection[]>(favoriteCollections).set([]);
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
    vi.unstubAllGlobals();
  });

  it('tracks the visible viewport as the keyboard opens, pans, and closes', () => {
    const viewport = Object.assign(new EventTarget(), {
      height: 800,
      offsetTop: 0,
    });
    vi.stubGlobal('visualViewport', viewport);
    const removeListener = vi.spyOn(viewport, 'removeEventListener');
    component = mount(CollectionPicker, {
      target: host,
      props: { item: { title: 'Item' }, onpick: vi.fn(), onclose: vi.fn() },
    });
    flushSync();
    const overlay = host.querySelector<HTMLElement>('.overlay')!;
    expect(overlay.style.getPropertyValue('--picker-height')).toBe('800px');

    viewport.height = 350;
    viewport.dispatchEvent(new Event('resize'));
    flushSync();
    expect(overlay.style.getPropertyValue('--picker-height')).toBe('350px');

    viewport.offsetTop = 70;
    viewport.dispatchEvent(new Event('scroll'));
    flushSync();
    expect(overlay.style.top).toBe('70px');

    viewport.height = 800;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('resize'));
    flushSync();
    expect(overlay.style.getPropertyValue('--picker-height')).toBe('800px');
    expect(overlay.style.top).toBe('0px');

    unmount(component);
    component = undefined;
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('shows each suggested collection with its group', () => {
    const work: CollectionGroup = {
      id: 'group-work',
      name: 'Work',
      collectionIds: ['collection-work'],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const personal: CollectionGroup = {
      id: 'group-personal',
      name: 'Personal',
      collectionIds: ['collection-personal'],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const workProject: Collection = {
      id: 'collection-work',
      name: 'Project',
      groupId: work.id,
      itemIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const personalProject: Collection = {
      id: 'collection-personal',
      name: 'Project',
      groupId: personal.id,
      itemIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    writableStore<Record<string, CollectionGroup>>(groups).set({
      [work.id]: work,
      [personal.id]: personal,
    });
    writableStore<CollectionGroup[]>(sortedGroups).set([work, personal]);
    writableStore<Record<string, Collection[]>>(groupCollections).set({
      [work.id]: [workProject],
      [personal.id]: [personalProject],
    });

    component = mount(CollectionPicker, {
      target: host,
      props: {
        item: { title: 'Project notes' },
        onpick: vi.fn(),
        onclose: vi.fn(),
      },
    });
    flushSync();

    const suggestedRows = [
      ...host.querySelectorAll<HTMLButtonElement>('.suggested ~ .option'),
    ].slice(0, 2);
    expect(suggestedRows).toHaveLength(2);
    expect(suggestedRows[0]?.textContent).toContain('Project');
    expect(
      suggestedRows[0]?.querySelector('.suggestion-group')?.textContent.trim(),
    ).toBe('Work');
    expect(suggestedRows[1]?.textContent).toContain('Project');
    expect(
      suggestedRows[1]?.querySelector('.suggestion-group')?.textContent.trim(),
    ).toBe('Personal');
  });

  it('lists favourites after suggestions, minus hidden and already-suggested ones', () => {
    const music: CollectionGroup = {
      id: 'group-music',
      name: 'Music',
      collectionIds: ['project', 'fiddle', 'hidden'],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const col = (id: string, name: string): Collection => ({
      id,
      name,
      groupId: music.id,
      itemIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const project = col('project', 'Project');
    const fiddle = col('fiddle', 'Fiddle');
    const hidden = col('hidden', 'Hidden band');

    writableStore<Record<string, CollectionGroup>>(groups).set({
      [music.id]: music,
    });
    writableStore<CollectionGroup[]>(sortedGroups).set([music]);
    writableStore<Record<string, Collection[]>>(groupCollections).set({
      [music.id]: [project, fiddle, hidden],
    });
    writableStore<Collection[]>(favoriteCollections).set([
      project,
      fiddle,
      hidden,
    ]);

    component = mount(CollectionPicker, {
      target: host,
      props: {
        item: { title: 'Project notes' },
        hiddenCollectionIds: new Set(['hidden']),
        onpick: vi.fn(),
        onclose: vi.fn(),
      },
    });
    flushSync();

    const label = host.querySelector('.favorites-label');
    expect(label?.textContent).toContain('Favorites');
    const favouriteRows: string[] = [];
    for (
      let el = label?.nextElementSibling;
      el?.classList.contains('option');
      el = el.nextElementSibling
    ) {
      favouriteRows.push(el.querySelector('.col-name')?.textContent ?? '');
    }
    // Project is already suggested (name match); Hidden band is filtered out.
    expect(favouriteRows).toEqual(['Fiddle']);
  });

  it('creates a group and collection together when filing without groups', async () => {
    const onpick = vi.fn();
    component = mount(CollectionPicker, {
      target: host,
      props: { item: { title: 'First item' }, onpick, onclose: vi.fn() },
    });
    flushSync();

    host.querySelector<HTMLButtonElement>('.create-option')?.click();
    flushSync();
    const inputs = host.querySelectorAll<HTMLInputElement>('.create-input');
    inputs[0]!.value = 'Reading';
    inputs[0]!.dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1]!.value = 'Personal';
    inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    host.querySelector<HTMLButtonElement>('.btn-create')?.click();
    await vi.waitFor(() => expect(onpick).toHaveBeenCalledOnce());

    expect(storeGroup).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Personal' }),
    );
    const createdGroup = vi.mocked(storeGroup).mock.calls[0]![0];
    expect(createCollection).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Reading', groupId: createdGroup.id }),
    );
    expect(onpick).toHaveBeenCalledWith(expect.any(String));
  });
});
