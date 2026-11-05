// @vitest-environment jsdom
import type { InboxItem } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { setItemPlan, storeItem, setItemCompleted } = vi.hoisted(() => ({
  setItemPlan: vi.fn().mockResolvedValue(undefined),
  storeItem: vi.fn().mockResolvedValue(undefined),
  setItemCompleted: vi.fn().mockResolvedValue(undefined),
}));

// The real move keeps kind, time and length; only the write is stubbed.
vi.mock('../lib/stores', async () => {
  const { moveItemToDay } = await import('../lib/plan');
  return {
    setItemPlan,
    storeItem,
    moveStoredItemToDay: (item: InboxItem, day: Date) =>
      storeItem(moveItemToDay(item, day)),
  };
});
vi.mock('../lib/schedule-sync', () => ({ setItemCompleted }));

import { planFor, toDateKey } from '../lib/plan';
import SlippedReview from './SlippedReview.svelte';

const todo = (id: string, extra: Partial<InboxItem> = {}): InboxItem =>
  ({
    id,
    type: 'todo',
    title: `Todo ${id}`,
    completed: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  }) as InboxItem;

describe('SlippedReview', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;
  const overdue = todo('late', {
    startsAt: '2026-09-03T07:00:00.000Z',
    scheduleKind: 'task',
  });
  const rolled = todo('rolled', { planKind: 'week', planStart: '2026-10-26' });

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(SlippedReview, {
      target: host,
      props: {
        overdue: [overdue],
        rolled: [{ todo: rolled, from: 'from last week' }],
        lookupCollection: () => null,
        onclose: vi.fn(),
      },
    });
    flushSync();
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  const actionsFor = (title: string) =>
    document.querySelector(
      `[role="group"][aria-label="What to do with ${title}"]`,
    );
  const click = (title: string, label: string) => {
    const btn = [...(actionsFor(title)?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent?.trim() === label,
    );
    if (!btn) throw new Error(`no "${label}" for ${title}`);
    btn.click();
    flushSync();
  };

  it('counts and lists overdue and rolled-over todos', () => {
    expect(document.querySelector('#slipped-title')?.textContent).toContain(
      '2 things slipped',
    );
    expect(document.body.textContent).toContain('from last week');
    // Only overdue todos get a "Today" shortcut.
    expect(actionsFor('Todo late')?.textContent).toContain('Today');
    expect(actionsFor('Todo rolled')?.textContent).not.toContain('Today');
  });

  it('re-plans a rolled-over todo', async () => {
    click('Todo rolled', 'Someday');
    await vi.waitFor(() => expect(setItemPlan).toHaveBeenCalledOnce());
    expect(setItemPlan).toHaveBeenCalledWith(
      rolled,
      planFor('someday', new Date()),
    );
  });

  it('plans a slipped todo for this week or next week', async () => {
    click('Todo rolled', 'This week');
    await vi.waitFor(() => expect(setItemPlan).toHaveBeenCalledOnce());
    expect(setItemPlan).toHaveBeenLastCalledWith(
      rolled,
      planFor('week', new Date()),
    );
    // Actions unlock once the first write settles.
    await vi.waitFor(() => {
      flushSync();
      expect(document.querySelector<HTMLButtonElement>('.act')?.disabled).toBe(
        false,
      );
    });
    click('Todo late', 'Next week');
    await vi.waitFor(() => expect(setItemPlan).toHaveBeenCalledTimes(2));
    expect(setItemPlan).toHaveBeenLastCalledWith(
      overdue,
      planFor('nextWeek', new Date()),
    );
  });

  it('holds every action while a write is in flight', async () => {
    let finish: () => void = () => {};
    setItemPlan.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    click('Todo rolled', 'Someday');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.act')];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    finish();
    await vi.waitFor(() => {
      flushSync();
      expect(buttons.every((b) => !b.disabled)).toBe(true);
    });
  });

  it('moves an overdue todo to today, keeping its kind and time', async () => {
    click('Todo late', 'Today');
    await vi.waitFor(() => expect(storeItem).toHaveBeenCalledOnce());
    const saved = storeItem.mock.calls[0][0] as InboxItem;
    const was = new Date(overdue.startsAt as string);
    const now = new Date(saved.startsAt as string);
    expect(saved.scheduleKind).toBe('task');
    expect(saved.allDay).toBeFalsy();
    expect(toDateKey(now)).toBe(toDateKey(new Date()));
    expect([now.getHours(), now.getMinutes()]).toEqual([
      was.getHours(),
      was.getMinutes(),
    ]);
  });

  it("keeps an overdue event's length when moved to today", async () => {
    if (component) unmount(component);
    const event = todo('meet', {
      startsAt: new Date(2026, 8, 3, 14, 0).toISOString(),
      endsAt: new Date(2026, 8, 3, 15, 30).toISOString(),
      scheduleKind: 'event',
    });
    component = mount(SlippedReview, {
      target: host,
      props: {
        overdue: [event],
        rolled: [],
        lookupCollection: () => null,
        onclose: vi.fn(),
      },
    });
    flushSync();
    click('Todo meet', 'Today');
    await vi.waitFor(() => expect(storeItem).toHaveBeenCalledOnce());
    const saved = storeItem.mock.calls[0][0] as InboxItem;
    const start = new Date(saved.startsAt as string);
    const end = new Date(saved.endsAt as string);
    expect(saved.scheduleKind).toBe('event');
    expect([start.getHours(), start.getMinutes()]).toEqual([14, 0]);
    expect((end.getTime() - start.getTime()) / 60_000).toBe(90);
  });

  it('completes a todo', async () => {
    click('Todo late', 'Done');
    await vi.waitFor(() =>
      expect(setItemCompleted).toHaveBeenCalledWith(overdue, true),
    );
  });
});
