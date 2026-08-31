// @vitest-environment jsdom

import type { BookmarkItem } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAG_MIME, draggingItemId } from '../lib/drag';
import {
  dragStartFrom,
  filingDragSurvivesNeuteredAncestor,
  stubMatchMedia,
} from '../lib/filing-drag-helpers';

vi.mock('../lib/stores', async () => {
  const { writable: w } = await import('svelte/store');
  return {
    connected: w(false),
    blobUrls: w<Record<string, string>>({}),
    loadFileBlobUrl: vi.fn(),
    setItemPinned: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../lib/rs', () => ({
  default: {},
  fetchFileBlobUrl: vi.fn(),
  fetchFileWithAuth: vi.fn(),
}));

import InboxCard from './InboxCard.svelte';

function bookmark(overrides: Partial<BookmarkItem> = {}): BookmarkItem {
  return {
    id: 'card-1',
    type: 'bookmark',
    title: 'Example',
    url: 'https://example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('InboxCard sidebar filing drag', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    stubMatchMedia();
    if (typeof DragEvent === 'undefined') {
      class PolyDragEvent extends Event {
        dataTransfer: DataTransfer | null;
        constructor(
          type: string,
          options?: EventInit & { dataTransfer?: DataTransfer | null },
        ) {
          super(type, options);
          this.dataTransfer = options?.dataTransfer ?? null;
        }
      }
      globalThis.DragEvent = PolyDragEvent as typeof DragEvent;
    }
    host = document.createElement('div');
    document.body.appendChild(host);
    draggingItemId.set(null);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
    draggingItemId.set(null);
  });

  it('sets the sidebar filing drag payload when a card is dragged', () => {
    component = mount(InboxCard, {
      target: host,
      props: { item: bookmark(), onselect: vi.fn() },
    });
    flushSync();

    const card = host.querySelector('article.card') as HTMLElement;
    const dataTransfer = dragStartFrom(card);
    expect(dataTransfer.getData(DRAG_MIME)).toBe('card-1');
    expect(get(draggingItemId)).toBe('card-1');
  });

  it('survives a drop-zone ancestor that cancels bubbling dragstart', () => {
    component = mount(InboxCard, {
      target: host,
      props: { item: bookmark(), onselect: vi.fn() },
    });
    flushSync();

    const card = host.querySelector('article.card') as HTMLElement;
    const { survived, dataTransfer } = filingDragSurvivesNeuteredAncestor(
      host,
      card,
    );
    expect(survived).toBe(true);
    expect(dataTransfer.getData(DRAG_MIME)).toBe('card-1');
  });
});
