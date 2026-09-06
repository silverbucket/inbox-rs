// @vitest-environment jsdom

import type { InboxItem } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import type { Writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubMatchMedia } from '../test/filing-drag-helpers';

// Only the stores the page and its cards read at render time are needed;
// the CRUD calls behind card controls are never reached here.
vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    items: writable({}),
    collections: writable({}),
    groups: writable({}),
    blobUrls: writable({}),
    blobLoadFailures: writable(new Set()),
    connected: writable(true),
    userSettings: writable({}),
    appConfig: writable({}),
    loadFileBlobUrl: vi.fn(),
    setItemPinned: vi.fn(),
  };
});

import { collections, groups, items } from '../lib/stores';
import SearchPage from './SearchPage.svelte';

const w = <T>(store: unknown) => store as Writable<T>;

const ITEMS: Record<string, InboxItem> = {
  'note-1': {
    id: 'note-1',
    type: 'note',
    title: 'Rust book notes',
    body: 'ownership and borrowing',
    createdAt: '2026-02-01T00:00:00.000Z',
  },
  'bm-1': {
    id: 'bm-1',
    type: 'bookmark',
    title: 'The Rust Programming Language',
    url: 'https://doc.rust-lang.org/book/',
    collectionId: 'col-1',
    createdAt: '2026-01-15T00:00:00.000Z',
  },
  'todo-1': {
    id: 'todo-1',
    type: 'todo',
    title: 'Finish rust chapter four',
    completed: false,
    createdAt: '2026-01-20T00:00:00.000Z',
  },
  'note-2': {
    id: 'note-2',
    type: 'note',
    title: 'Gardening plan',
    body: 'tomatoes and basil',
    createdAt: '2026-01-10T00:00:00.000Z',
  },
};

describe('SearchPage', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;
  let onquerychange: ReturnType<typeof vi.fn>;
  let onselect: ReturnType<typeof vi.fn>;
  let onfocuscollection: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubMatchMedia();
    // IntersectionObserver backs the load-more sentinel; jsdom lacks it.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    w<Record<string, InboxItem>>(items).set(ITEMS);
    w<Record<string, unknown>>(collections).set({
      'col-1': {
        id: 'col-1',
        name: 'Reading',
        color: '#6366f1',
        groupId: 'group-1',
        itemIds: ['bm-1'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    w<Record<string, unknown>>(groups).set({
      'group-1': {
        id: 'group-1',
        name: 'Personal',
        collectionIds: ['col-1'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    onquerychange = vi.fn();
    onselect = vi.fn();
    onfocuscollection = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
    vi.unstubAllGlobals();
  });

  // Reactive so a test can change a prop after mounting, as App does when
  // the route changes.
  type Props = {
    query: string;
    focusOnMount?: boolean;
    focusNonce?: number;
  };
  const props: Props = $state({ query: '' });

  function render(initial: Partial<Props> = {}) {
    props.query = initial.query ?? '';
    props.focusOnMount = initial.focusOnMount;
    props.focusNonce = initial.focusNonce;
    component = mount(SearchPage, {
      target: host,
      props: {
        onquerychange,
        onselect,
        onfocuscollection,
        get query() {
          return props.query;
        },
        get focusOnMount() {
          return props.focusOnMount;
        },
        get focusNonce() {
          return props.focusNonce;
        },
      },
    });
    flushSync();
  }

  function input(): HTMLInputElement {
    const el = host.querySelector<HTMLInputElement>('input[type="search"]');
    if (!el) throw new Error('search input not rendered');
    return el;
  }

  function type(text: string) {
    const el = input();
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }

  it('shows the prompt and no results until something is typed', () => {
    render();
    expect(host.querySelector('.page-hint')).not.toBeNull();
    expect(host.querySelector('.result-section')).toBeNull();
    expect(host.querySelector('.status-bar')).toBeNull();
  });

  it('starts from the route query', () => {
    render({ query: 'rust' });
    expect(input().value).toBe('rust');
    expect(host.querySelector('.status-bar')?.textContent).toContain('3');
  });

  it('splits matches into todos and cards, with where each card lives', () => {
    render();
    type('rust');

    expect(onquerychange).toHaveBeenCalledWith('rust');
    expect(host.querySelector('.status-bar')?.textContent).toMatch(
      /3\s*results for “rust”/,
    );

    const sections = host.querySelectorAll('.result-section');
    expect(sections).toHaveLength(2);
    expect(sections[0].textContent).toContain('Finish rust chapter four');
    expect(sections[1].textContent).toContain('Rust book notes');
    expect(sections[1].textContent).toContain('The Rust Programming Language');
    expect(host.textContent).not.toContain('Gardening plan');

    const chips = Array.from(host.querySelectorAll('.where-chip')).map((c) =>
      c.textContent?.trim(),
    );
    expect(chips).toEqual(['Inbox', 'Reading']);
  });

  it('opens a result’s collection from its chip', () => {
    render({ query: 'programming' });
    const chip = host.querySelector<HTMLButtonElement>('.where-link');
    expect(chip?.textContent).toContain('Reading');
    chip?.click();
    expect(onfocuscollection).toHaveBeenCalledWith('col-1');
  });

  it('says so when nothing matches', () => {
    render();
    type('zebra');
    expect(host.querySelector('.empty-state')?.textContent).toContain(
      'Nothing matches “zebra”',
    );
    expect(host.querySelector('.result-section')).toBeNull();
  });

  it('treats a whitespace-only query as empty', () => {
    render();
    type('   ');
    expect(host.querySelector('.page-hint')).not.toBeNull();
    expect(host.querySelector('.empty-state')).toBeNull();
  });

  it('clears with the button and with Escape, then blurs on a second Escape', () => {
    render({ query: 'rust' });
    const el = input();
    el.focus();

    host.querySelector<HTMLButtonElement>('.search-clear')?.click();
    flushSync();
    expect(el.value).toBe('');
    expect(onquerychange).toHaveBeenLastCalledWith('');
    expect(document.activeElement).toBe(el);

    type('rust');
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    flushSync();
    expect(el.value).toBe('');
    expect(onquerychange).toHaveBeenLastCalledWith('');
    expect(document.activeElement).toBe(el);

    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    flushSync();
    expect(document.activeElement).not.toBe(el);
  });

  it('adopts a new query from the route', () => {
    render({ query: 'rust' });
    props.query = 'gardening';
    flushSync();
    expect(input().value).toBe('gardening');
    expect(host.textContent).toContain('Gardening plan');
    expect(host.textContent).not.toContain('Rust book notes');
    // Only edits report back; adopting the route is not an edit.
    expect(onquerychange).not.toHaveBeenCalled();
  });

  it('focuses the field on mount when asked, and again on a nonce bump', () => {
    render({ focusOnMount: true, focusNonce: 0 });
    expect(document.activeElement).toBe(input());
    input().blur();
    expect(document.activeElement).not.toBe(input());

    props.focusNonce = 1;
    flushSync();
    expect(document.activeElement).toBe(input());
  });

  it('leaves focus alone on touch (no focusOnMount)', () => {
    render();
    expect(document.activeElement).not.toBe(input());
  });
});
