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
vi.mock('./ScheduleSheet.svelte', async () => ({
  default: (await import('../test/ScheduleSheet.stub.svelte')).default,
}));
vi.mock('../lib/schedule-sync', () => ({
  setItemCompleted: vi.fn().mockResolvedValue(undefined),
}));

import type { InboxItem } from '@inbox-rs/rs-module';
import { DRAG_MIME, draggingItemId } from '../lib/drag';
import { setItemCompleted } from '../lib/schedule-sync';
import {
  dragStartFrom,
  mousedownReachesZoneUncancelled,
  stubMatchMedia,
} from '../test/filing-drag-helpers';
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

  it.each([
    'event',
    'task',
  ] as const)('labels %s schedules accurately', (scheduleKind) => {
    component = mount(TodoRow, {
      target: host,
      props: {
        todo: todo({ scheduleKind, startsAt: '2027-01-01T12:00:00Z' }),
        collection: null,
        group: null,
        onselect: vi.fn(),
      },
    });
    flushSync();
    expect(host.querySelector('.sched-chip')?.textContent?.trim()).toMatch(
      scheduleKind === 'event' ? /^Scheduled / : /^Due /,
    );
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
    flushSync();

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
    flushSync();

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
    flushSync();

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
    flushSync();

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
    flushSync();

    expect(dataTransfer.getData(DRAG_MIME)).toBe('todo-1');
    expect(get(draggingItemId)).toBe('todo-1');
  });

  it('does not let parent reorder zones cancel todo mousedown', () => {
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

    const zone = document.createElement('div');
    zone.addEventListener('mousedown', (e) => e.preventDefault());
    zone.appendChild(host);
    const title = host.querySelector('.title') as HTMLElement;
    expect(mousedownReachesZoneUncancelled(zone, title)).toBe(true);
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

describe('TodoRow touch swipes', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    stubMatchMedia();
    host = document.createElement('div');
    document.body.appendChild(host);
    vi.mocked(setItemCompleted).mockClear();
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  function touch(el: Element, type: string, x = 0, y = 0) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    const points = type === 'touchend' ? [] : [{ clientX: x, clientY: y }];
    Object.defineProperty(e, 'touches', { value: points });
    el.dispatchEvent(e);
    flushSync();
  }

  function swipe(el: Element, dx: number, dy = 0) {
    touch(el, 'touchstart', 200, 100);
    for (let i = 1; i <= 5; i++) {
      touch(el, 'touchmove', 200 + (dx * i) / 5, 100 + (dy * i) / 5);
    }
    touch(el, 'touchend');
  }

  function render(props: Record<string, unknown> = {}) {
    const onselect = vi.fn();
    component = mount(TodoRow, {
      target: host,
      props: {
        todo: todo(),
        collection: null,
        group: null,
        onselect,
        ...props,
      },
    });
    flushSync();
    const row = host.querySelector('.todo-row') as HTMLElement;
    return { row, onselect };
  }

  it('completes on a right swipe without opening the card', async () => {
    const { row, onselect } = render();
    swipe(row.querySelector('.title') as Element, 120);
    await Promise.resolve();
    expect(setItemCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'todo-1' }),
      true,
    );
    row.click();
    expect(onselect).not.toHaveBeenCalled();
  });

  it('opens When? on a left swipe, outside the row', () => {
    const { row } = render();
    swipe(row.querySelector('.title') as Element, -120);
    const sheet = document.body.querySelector('[role="dialog"]');
    expect(sheet?.getAttribute('data-title')).toBe('Buy milk');
    expect(row.contains(sheet)).toBe(false);
    (sheet?.querySelector('button') as HTMLButtonElement).click();
    flushSync();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('ignores short, vertical and calendar-receipt swipes', () => {
    const { row } = render();
    swipe(row, 40);
    swipe(row, 120, 200);
    expect(setItemCompleted).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    unmount(component as ReturnType<typeof mount>);
    component = undefined;
    const receipt = render({ readonly: true });
    swipe(receipt.row, 120);
    swipe(receipt.row, -120);
    expect(setItemCompleted).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('swallows a click on the checkbox right after a swipe', () => {
    const { row } = render();
    const box = row.querySelector('input.checkbox') as HTMLInputElement;
    swipe(box, -120);
    box.click();
    expect(box.checked).toBe(false);
    expect(setItemCompleted).not.toHaveBeenCalled();
  });

  it('does not reopen a completed todo on a right swipe', () => {
    const { row } = render({ todo: todo({ completed: true }) });
    swipe(row, 120);
    expect(setItemCompleted).not.toHaveBeenCalled();
  });

  it('cancels when another finger is still down at release', () => {
    const { row } = render();
    touch(row, 'touchstart', 200, 100);
    touch(row, 'touchmove', 260, 100);
    touch(row, 'touchmove', 340, 100);
    const end = new Event('touchend', { bubbles: true });
    Object.defineProperty(end, 'touches', {
      value: [{ clientX: 10, clientY: 10 }],
    });
    row.dispatchEvent(end);
    flushSync();
    expect(setItemCompleted).not.toHaveBeenCalled();
    expect(row.classList.contains('swiping')).toBe(false);
  });

  it('renders as a div when its list supplies the <li>', () => {
    const { row } = render({ as: 'div' });
    expect(row.tagName).toBe('DIV');
  });
});
