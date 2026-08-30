// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    setItemPinned: vi.fn().mockResolvedValue(undefined),
    items: writable({}),
  };
});
vi.mock('../lib/schedule-sync', () => ({
  setItemCompleted: vi.fn().mockResolvedValue(undefined),
}));

import type { InboxItem } from '@inbox-rs/rs-module';
import { DRAG_MIME, draggingItemId } from '../lib/drag';
import TodoRow from './TodoRow.svelte';

function todo(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'todo-1',
    type: 'todo',
    title: 'Buy milk',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as InboxItem;
}

describe('TodoRow sidebar filing drag', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
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

  it('sets the sidebar filing drag payload when the row is dragged', () => {
    const item = todo();
    component = mount(TodoRow, {
      target: host,
      props: {
        todo: item,
        collection: null,
        group: null,
        onselect: vi.fn(),
      },
    });
    flushSync();

    const row = host.querySelector('.todo-row') as HTMLElement;
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      data: new Map<string, string>(),
      setData(type: string, value: string) {
        this.data.set(type, value);
      },
      getData(type: string) {
        return this.data.get(type) ?? '';
      },
    };

    row.dispatchEvent(
      new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dataTransfer as DataTransfer,
      }),
    );
    flushSync();

    expect(dataTransfer.getData(DRAG_MIME)).toBe('todo-1');
    expect(get(draggingItemId)).toBe('todo-1');
  });

  it('does not start a filing drag from the reorder handle', () => {
    const item = todo();
    component = mount(TodoRow, {
      target: host,
      props: {
        todo: item,
        collection: null,
        group: null,
        reorderable: true,
        onselect: vi.fn(),
      },
    });
    flushSync();

    const handle = host.querySelector('.reorder-handle') as HTMLElement;
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      data: new Map<string, string>(),
      setData(type: string, value: string) {
        this.data.set(type, value);
      },
      getData(type: string) {
        return this.data.get(type) ?? '';
      },
    };

    const event = new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dataTransfer as DataTransfer,
    });
    Object.defineProperty(event, 'target', { value: handle });

    rowDispatchFromHandle(event, handle);
    flushSync();

    expect(dataTransfer.getData(DRAG_MIME)).toBe('');
    expect(get(draggingItemId)).toBeNull();
  });

  it('clears filing drag state on dragend', () => {
    const item = todo();
    component = mount(TodoRow, {
      target: host,
      props: {
        todo: item,
        collection: null,
        group: null,
        onselect: vi.fn(),
      },
    });
    flushSync();

    draggingItemId.set('todo-1');
    const row = host.querySelector('.todo-row') as HTMLElement;
    row.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    flushSync();

    expect(get(draggingItemId)).toBeNull();
  });
});

function rowDispatchFromHandle(event: DragEvent, handle: HTMLElement) {
  const row = handle.closest('.todo-row') as HTMLElement;
  row.dispatchEvent(event);
}
