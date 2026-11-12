// @vitest-environment jsdom
import type { InboxItem } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import type { writable } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { todayStart } = vi.hoisted(() => ({
  // Wednesday, November 4, 2026.
  todayStart: { store: null as unknown as ReturnType<typeof writable<number>> },
}));

vi.mock('../lib/now', async () => {
  const { writable: w } = await import('svelte/store');
  todayStart.store = w(new Date(2026, 10, 4).getTime());
  return { todayStart: todayStart.store, now: w(new Date(2026, 10, 4, 10)) };
});

import { type Placement, placeTodo } from '../lib/plan';
import TodosToday from './TodosToday.svelte';

const todo = (id: string, extra: Partial<InboxItem> = {}): InboxItem =>
  ({
    id,
    type: 'todo',
    title: `Todo ${id}`,
    completed: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  }) as InboxItem;

describe('TodosToday', () => {
  let host: HTMLElement | undefined;
  let component: ReturnType<typeof mount> | undefined;

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host?.remove();
  });

  const render = (todos: InboxItem[]) => {
    const now = new Date(2026, 10, 4, 10);
    const placements = new Map<string, Placement>(
      todos.map((t) => [t.id, placeTodo(t, now)]),
    );
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(TodosToday, {
      target: host,
      props: {
        todos,
        placements,
        overdueCount: 0,
        rolledCount: 0,
        lookupCollection: () => null,
        lookupGroup: () => null,
        onselect: vi.fn(),
        onaddincollection: vi.fn(),
        onreview: vi.fn(),
        onshowplan: vi.fn(),
      },
    });
    flushSync();
  };

  const section = (id: string) =>
    document.querySelector(`[aria-labelledby="${id}"]`);
  const day = (n: number) =>
    [...document.querySelectorAll<HTMLButtonElement>('.week .day')].find(
      (b) => b.querySelector('.n')?.textContent === String(n),
    );

  it('lists a picked day once, not again under Later this week', () => {
    render([
      todo('fri', { startsAt: new Date(2026, 10, 6, 9).toISOString() }),
      todo('sat', { startsAt: new Date(2026, 10, 7, 9).toISOString() }),
    ]);
    expect(section('today-week')?.textContent).toContain('Todo fri');
    day(6)?.click();
    flushSync();
    expect(section('today-picked')?.textContent).toContain('Todo fri');
    expect(section('today-week')?.textContent).not.toContain('Todo fri');
    expect(section('today-week')?.textContent).toContain('Todo sat');
  });

  it('shows a multi-day event on its middle day, marked as ongoing', () => {
    // Tuesday to Thursday; today is the Wednesday in between.
    const trip = todo('trip', {
      startsAt: new Date(2026, 10, 3).toISOString(),
      endsAt: new Date(2026, 10, 5).toISOString(),
      allDay: true,
      scheduleKind: 'event',
    });
    render([trip]);
    const due = section('today-due');
    expect(due?.textContent).toContain('Todo trip');
    expect(due?.querySelector('.day-tag')?.textContent).toBe('Day 2 of 3');
    expect(day(5)?.querySelector('.mark.on')).not.toBeNull();
    expect(day(6)?.querySelector('.mark.on')).toBeNull();
    day(5)?.click();
    flushSync();
    expect(
      section('today-picked')?.querySelector('.day-tag')?.textContent,
    ).toBe('Day 3 of 3');
  });

  it('sorts a day by time, not by the stored string', () => {
    // Same moment written with different offsets sorts wrong as text.
    const early = todo('early', { startsAt: '2026-11-06T09:00:00+02:00' });
    const late = todo('late', { startsAt: '2026-11-06T08:30:00Z' });
    render([late, early]);
    day(6)?.click();
    flushSync();
    const titles = [
      ...(section('today-picked')?.querySelectorAll('.title') ?? []),
    ].map((el) => el.textContent?.trim());
    expect(titles).toEqual(['Todo early', 'Todo late']);
  });

  it('falls back to today when the picked day leaves the week strip', () => {
    render([]);
    day(6)?.click();
    flushSync();
    expect(day(6)?.getAttribute('aria-pressed')).toBe('true');
    // Midnight rolls over into the next week.
    todayStart.store.set(new Date(2026, 10, 9).getTime());
    flushSync();
    expect(section('today-picked')).toBeNull();
    expect(day(9)?.getAttribute('aria-pressed')).toBe('true');
  });
});
