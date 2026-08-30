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

function makeDataTransfer() {
  const data = new Map<string, string>();
  return {
    effectAllowed: '',
    dropEffect: '',
    setData(type: string, value: string) {
      data.set(type, value);
    },
    getData(type: string) {
      return data.get(type) ?? '';
    },
  } as DataTransfer;
}

function dragStartFrom(
  row: HTMLElement,
  options?: { target?: EventTarget; pointerTarget?: EventTarget },
) {
  if (options?.pointerTarget) {
    const pointer = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(pointer, 'target', { value: options.pointerTarget });
    row.dispatchEvent(pointer);
  }

  const dataTransfer = makeDataTransfer();
  const event = new DragEvent('dragstart', {
    bubbles: true,
    cancelable: true,
    dataTransfer,
  });
  if (options?.target) {
    Object.defineProperty(event, 'target', { value: options.target });
  }
  row.dispatchEvent(event);
  flushSync();
  return dataTransfer;
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
    const dataTransfer = dragStartFrom(row);

    expect(dataTransfer.getData(DRAG_MIME)).toBe('todo-1');
    expect(get(draggingItemId)).toBe('todo-1');
  });

  it('uses a non-form reorder handle so dragHandleZone can start reordering', () => {
    component = mount(TodoRow, {
      target: host,
      props: {
        todo: todo(),
        collection: null,
        group: null,
        reorderable: true,
        onselect: vi.fn(),
      },
    });
    flushSync();

    const handle = host.querySelector('.reorder-handle') as HTMLElement;
    expect(handle.tagName).toBe('SPAN');
    expect(handle.getAttribute('role')).toBe('button');
    expect(host.querySelector('button.reorder-handle')).toBeNull();
  });

  it('does not start a filing drag from the reorder handle', () => {
    component = mount(TodoRow, {
      target: host,
      props: {
        todo: todo(),
        collection: null,
        group: null,
        reorderable: true,
        onselect: vi.fn(),
      },
    });
    flushSync();

    const row = host.querySelector('.todo-row') as HTMLElement;
    const handle = host.querySelector('.reorder-handle') as HTMLElement;
    const dataTransfer = dragStartFrom(row, {
      pointerTarget: handle,
      target: row,
    });

    expect(dataTransfer.getData(DRAG_MIME)).toBe('');
    expect(get(draggingItemId)).toBeNull();
  });

  it('does not start a filing drag from the pin button', () => {
    component = mount(TodoRow, {
      target: host,
      props: {
        todo: todo(),
        collection: null,
        group: null,
        reorderable: true,
        onselect: vi.fn(),
      },
    });
    flushSync();

    const row = host.querySelector('.todo-row') as HTMLElement;
    const pin = host.querySelector('.pin-button') as HTMLElement;
    const dataTransfer = dragStartFrom(row, {
      pointerTarget: pin,
      target: row,
    });

    expect(dataTransfer.getData(DRAG_MIME)).toBe('');
    expect(get(draggingItemId)).toBeNull();
  });

  it('does not start a filing drag from the completion checkbox', () => {
    component = mount(TodoRow, {
      target: host,
      props: {
        todo: todo(),
        collection: null,
        group: null,
        onselect: vi.fn(),
      },
    });
    flushSync();

    const row = host.querySelector('.todo-row') as HTMLElement;
    const checkbox = host.querySelector('.checkbox') as HTMLElement;
    const dataTransfer = dragStartFrom(row, {
      pointerTarget: checkbox,
      target: row,
    });

    expect(dataTransfer.getData(DRAG_MIME)).toBe('');
    expect(get(draggingItemId)).toBeNull();
  });

  it('does not throw when dragstart targets a text node', () => {
    component = mount(TodoRow, {
      target: host,
      props: {
        todo: todo(),
        collection: null,
        group: null,
        onselect: vi.fn(),
      },
    });
    flushSync();

    const row = host.querySelector('.todo-row') as HTMLElement;
    const titleText = host.querySelector('.title')?.firstChild as Text;
    const dataTransfer = dragStartFrom(row, {
      pointerTarget: titleText,
      target: titleText,
    });

    expect(dataTransfer.getData(DRAG_MIME)).toBe('todo-1');
    expect(get(draggingItemId)).toBe('todo-1');
  });

  it('clears filing drag state on dragend', () => {
    component = mount(TodoRow, {
      target: host,
      props: {
        todo: todo(),
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
