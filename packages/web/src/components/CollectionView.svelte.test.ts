// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { captureDetected, showToast, storeFns } = vi.hoisted(() => ({
  captureDetected: vi.fn(),
  showToast: vi.fn(),
  storeFns: {
    deleteItem: vi.fn(),
    moveCollectionToGroup: vi.fn(),
    updateConfig: vi.fn(),
    reorderCollectionItems: vi.fn(),
    moveItemToCollection: vi.fn().mockResolvedValue(undefined),
    storeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../lib/capture', () => ({ captureDetected }));
vi.mock('../lib/toast', () => ({ showToast }));
vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    collectionItems: writable({}),
    sortedGroups: writable([]),
    appConfig: writable({}),
    groups: writable({}),
    collections: writable({}),
    groupCollections: writable({}),
    ...storeFns,
  };
});

import type { InboxItem } from '@inbox-rs/rs-module';
import { collectionItems } from '../lib/stores';
import CollectionView from './CollectionView.svelte';

describe('CollectionView capture handling', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  const collection = {
    id: 'col-1',
    name: 'Reading',
    color: '#6366f1',
    itemIds: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storeFns.storeItem.mockResolvedValue(undefined);
    storeFns.moveItemToCollection.mockResolvedValue(undefined);
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  function render() {
    component = mount(CollectionView, {
      target: host,
      props: {
        collection,
        expanded: true,
        onselect: vi.fn(),
        onedit: vi.fn(),
        ontoggle: vi.fn(),
      },
    });
    flushSync();
  }

  // Drive the real child CaptureBar: typing + Enter emits oncapture, which the
  // collection wires to handleCapture.
  function captureViaBar(text: string) {
    const bar = host.querySelector('.capture .text-input') as HTMLInputElement;
    bar.value = text;
    bar.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    bar.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    flushSync();
  }

  it('files a capture into this collection and offers Undo on success', async () => {
    captureDetected.mockResolvedValue({ item: { id: 'i1', type: 'note' } });
    render();
    captureViaBar('remember the milk');
    await vi.waitFor(() => {
      expect(captureDetected).toHaveBeenCalledWith(
        'remember the milk',
        'col-1',
      );
    });
    expect(showToast).toHaveBeenCalledWith(
      'Saved note',
      expect.objectContaining({ label: 'Undo' }),
    );
  });

  it('surfaces an error toast (not an unhandled rejection) when the capture throws', async () => {
    captureDetected.mockRejectedValue(
      new Error('Target collection no longer exists'),
    );
    render();
    captureViaBar('remember the milk');
    await vi.waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't save — this collection is no longer available.",
      );
    });
  });
});

describe('CollectionView header keyboard handling', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  const collection = {
    id: 'col-1',
    name: 'Reading',
    color: '#6366f1',
    itemIds: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  function renderWith(props: { ontoggle: () => void; onfocus?: () => void }) {
    component = mount(CollectionView, {
      target: host,
      props: {
        collection,
        expanded: false,
        onselect: vi.fn(),
        onedit: vi.fn(),
        ...props,
      },
    });
    flushSync();
  }

  function pressEnter(el: HTMLElement) {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    flushSync();
  }

  it('toggles on Enter when the header itself is focused', () => {
    const ontoggle = vi.fn();
    renderWith({ ontoggle });
    pressEnter(host.querySelector('.collection-header') as HTMLElement);
    expect(ontoggle).toHaveBeenCalledTimes(1);
  });

  /**
   * Enter/Space on a header-action button bubbles up to the header, whose
   * handler used to preventDefault (killing the button's activation) and
   * toggle the collection instead — a keyboard user "clicking" Focus or
   * Edit collapsed the card. The header must ignore keydowns it didn't
   * originate.
   */
  it('does not toggle when Enter lands on a header-action button', () => {
    const ontoggle = vi.fn();
    renderWith({ ontoggle, onfocus: vi.fn() });
    const focusBtn = host.querySelector(
      '[aria-label="Focus on Reading"]',
    ) as HTMLElement;
    expect(focusBtn).toBeTruthy();
    pressEnter(focusBtn);
    expect(ontoggle).not.toHaveBeenCalled();
  });
});

/**
 * Scheduling must mean the same thing on every todo list: a collection's
 * Todos section pins due/overdue todos in a Due band above the manual order,
 * exactly like the flat Todos page — a todo due today must not sit at the
 * bottom just because it was filed last.
 */
describe('CollectionView due todos band', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  const collection = {
    id: 'col-1',
    name: 'Reading',
    color: '#6366f1',
    itemIds: ['t-old', 't-overdue', 't-today'],
  };

  const todo = (
    id: string,
    title: string,
    startsAt?: string,
  ): Partial<InboxItem> => ({
    id,
    title,
    type: 'todo',
    isTodo: true,
    collectionId: collection.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...(startsAt ? { startsAt, scheduleKind: 'task' as const } : {}),
  });

  // Dates relative to the real clock — the due band is date-based, so
  // "yesterday"/"today"/"tomorrow" are stable regardless of when tests run.
  const at = (dayOffset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
    (collectionItems as unknown as { set: (v: unknown) => void }).set({
      [collection.id]: [
        // Manual itemIds order deliberately puts the scheduled todos last.
        todo('t-old', 'manual first'),
        todo('t-overdue', 'was due yesterday', at(-1)),
        todo('t-today', 'due today', at(0)),
        todo('t-tomorrow', 'due tomorrow', at(1)),
      ],
    });
  });
  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
    (collectionItems as unknown as { set: (v: unknown) => void }).set({});
  });

  function render() {
    component = mount(CollectionView, {
      target: host,
      props: {
        collection,
        expanded: true,
        onselect: vi.fn(),
        onedit: vi.fn(),
        ontoggle: vi.fn(),
      },
    });
    flushSync();
  }

  const titles = (root: Element | null) =>
    [...(root?.querySelectorAll('.title') ?? [])].map((el) =>
      el.textContent?.trim(),
    );

  it('pins due/overdue todos in a Due band, earliest first', () => {
    render();
    const band = host.querySelector('.todos-section .due-band');
    expect(band).toBeTruthy();
    expect(titles(band)).toEqual(['was due yesterday', 'due today']);
  });

  it('keeps future and unscheduled todos in manual order below the band', () => {
    render();
    const band = host.querySelector('.todos-section .due-band');
    const manualList = [
      ...host.querySelectorAll('.todos-section .todo-list'),
    ].find((ul) => !band?.contains(ul));
    expect(titles(manualList ?? null)).toEqual([
      'manual first',
      'due tomorrow',
    ]);
  });

  it('renders no band when nothing is due', () => {
    (collectionItems as unknown as { set: (v: unknown) => void }).set({
      [collection.id]: [todo('t-old', 'manual first', at(1))],
    });
    render();
    expect(host.querySelector('.todos-section .due-band')).toBeNull();
    expect(titles(host.querySelector('.todos-section'))).toEqual([
      'manual first',
    ]);
  });
});
