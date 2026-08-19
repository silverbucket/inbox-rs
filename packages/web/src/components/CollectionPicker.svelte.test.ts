// @vitest-environment jsdom
import type { Collection, CollectionGroup } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import type { Writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    appConfig: writable({}),
    createCollection: vi.fn().mockResolvedValue(undefined),
    groupCollections: writable({}),
    groups: writable({}),
    items: writable({}),
    orphanCollections: writable([]),
    sortedGroups: writable([]),
    updateConfig: vi.fn().mockResolvedValue(undefined),
  };
});

import { groupCollections, groups, sortedGroups } from '../lib/stores';
import CollectionPicker from './CollectionPicker.svelte';

const writableStore = <T>(store: unknown) => store as Writable<T>;

describe('CollectionPicker', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
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
});
