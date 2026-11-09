// @vitest-environment jsdom

import type { NoteItem } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAG_MIME, draggingItemId } from '../lib/drag';
import { dragStartFrom } from '../test/filing-drag-helpers';

vi.mock('../lib/stores', async () => {
  const { writable: w } = await import('svelte/store');
  return { items: w({}), collections: w({}), restoring: w(false) };
});
vi.mock('../lib/rs', () => ({ default: {}, fetchFileBlobUrl: vi.fn() }));

import EventAgenda from './EventAgenda.svelte';

const event = (over: Partial<NoteItem> = {}): NoteItem => ({
  id: 'ev-1',
  type: 'note',
  body: '',
  title: 'Dentist',
  createdAt: '2026-01-01T00:00:00.000Z',
  startsAt: '2099-03-04T14:00:00.000Z',
  endsAt: '2099-03-04T15:00:00.000Z',
  scheduleKind: 'event',
  location: 'Smile Clinic',
  ...over,
});

describe('EventAgenda', () => {
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
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
    draggingItemId.set(null);
  });

  function render(events: NoteItem[]) {
    component = mount(EventAgenda, {
      target: host,
      props: { events, onselect: vi.fn() },
    });
    flushSync();
    return host.querySelector('button.row') as HTMLButtonElement;
  }

  it('names the date, time, location and cancellation for screen readers', () => {
    const row = render([event({ cancelled: true })]);
    const label = row.getAttribute('aria-label') ?? '';
    const day = new Date('2099-03-04T14:00:00.000Z').toLocaleDateString(
      undefined,
      { weekday: 'long', day: 'numeric', month: 'long' },
    );
    expect(label).toContain('Open Dentist');
    expect(label).toContain(day);
    expect(label).toContain('Smile Clinic');
    expect(label).toContain('cancelled');
    expect(label).toMatch(/–/); // the time range
  });

  it('drags onto sidebar collections like the cards it replaces', () => {
    const row = render([event()]);
    expect(row.getAttribute('draggable')).toBe('true');
    const data = dragStartFrom(row);
    expect(data.getData(DRAG_MIME)).toBe('ev-1');
    expect(get(draggingItemId)).toBe('ev-1');
    row.dispatchEvent(new Event('dragend', { bubbles: true }));
    expect(get(draggingItemId)).toBeNull();
  });
});
