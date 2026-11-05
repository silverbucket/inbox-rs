// @vitest-environment jsdom
import type { InboxItem } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import type { Writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  todoFromInbox: vi.fn(),
  fileFromInbox: vi.fn(),
  archiveFromInbox: vi.fn(),
}));

vi.mock('../lib/triage-actions', () => actions);
vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    items: writable({}),
    sortedItems: writable([]),
    collections: writable({}),
  };
});

import { planFor } from '../lib/plan';
import { collections, items, sortedItems } from '../lib/stores';
import TriagePanel from './TriagePanel.svelte';

const note = (id: string, title: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'note',
    title,
    body: '',
    createdAt: new Date().toISOString(),
    ...extra,
  }) as unknown as InboxItem;

const cards = [
  note('a', 'First card'),
  note('b', 'Second card', { body: 'Dinner on Dec 3' }),
  note('c', 'Third card'),
];

/** Mimic the stores: a handled card leaves the inbox. */
function leaveInbox(id: string) {
  (sortedItems as unknown as Writable<InboxItem[]>).update((list) =>
    list.filter((i) => i.id !== id),
  );
}

describe('TriagePanel', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;
  const onopen = vi.fn();
  const onclose = vi.fn();
  const oncurrent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Object.values(actions)) {
      fn.mockImplementation(async (item: InboxItem) => {
        leaveInbox(item.id);
        return true;
      });
    }
    (items as unknown as Writable<Record<string, InboxItem>>).set(
      Object.fromEntries(cards.map((c) => [c.id, c])),
    );
    (sortedItems as unknown as Writable<InboxItem[]>).set([...cards]);
    (collections as unknown as Writable<Record<string, unknown>>).set({});
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(TriagePanel, {
      target: host,
      props: {
        queue: cards.map((c) => c.id),
        hintsFor: (item: InboxItem) =>
          item.id === 'c' ? { flag: 'No title came through — add one?' } : {},
        onopen,
        onclose,
        oncurrent,
      },
    });
    flushSync();
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
    for (const el of document.querySelectorAll('[aria-modal]')) el.remove();
  });

  const title = () => document.querySelector('.triage .title')?.textContent;
  const press = (key: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    flushSync();
  };
  const settle = () =>
    vi.waitFor(() =>
      expect(document.querySelector('.chip:disabled')).toBeNull(),
    );

  it('shows one card at a time with its position', () => {
    expect(title()).toBe('First card');
    expect(document.querySelector('.count')?.textContent).toBe('1 of 3');
    expect(oncurrent).toHaveBeenLastCalledWith('a');
  });

  it('plans a card for a horizon by key and moves on', async () => {
    press('w');
    await settle();
    expect(actions.todoFromInbox).toHaveBeenCalledWith(
      cards[0],
      { plan: planFor('week', new Date()) },
      'This week',
      expect.any(Function),
    );
    expect(title()).toBe('Second card');
  });

  it('makes Today a dated todo', async () => {
    press('t');
    await settle();
    const when = actions.todoFromInbox.mock.calls[0][1] as { day: Date };
    expect(when.day.toDateString()).toBe(new Date().toDateString());
  });

  it('offers the date a card mentions', async () => {
    press('j');
    expect(title()).toBe('Second card');
    expect(document.querySelector('.date-hint')?.textContent).toContain('Dec');
    press('d');
    await settle();
    const when = actions.todoFromInbox.mock.calls[0][1] as { day: Date };
    expect([when.day.getMonth(), when.day.getDate()]).toEqual([11, 3]);
  });

  it('archives, skips and goes back', async () => {
    press('ArrowRight');
    expect(title()).toBe('Second card');
    press('ArrowLeft');
    expect(title()).toBe('First card');
    press('a');
    await settle();
    expect(actions.archiveFromInbox).toHaveBeenCalledWith(
      cards[0],
      expect.any(Function),
    );
    expect(title()).toBe('Second card');
  });

  it('shows the card again when its action is undone', async () => {
    press('s');
    await settle();
    expect(title()).toBe('Second card');
    const onundo = actions.todoFromInbox.mock.calls[0][3] as () => void;
    (sortedItems as unknown as Writable<InboxItem[]>).set([...cards]);
    onundo();
    flushSync();
    expect(title()).toBe('First card');
  });

  it('keeps the user’s place when they move on before a failed write settles', async () => {
    let fail: (ok: boolean) => void = () => {};
    actions.archiveFromInbox.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (fail = resolve)),
    );
    press('a');
    expect(title()).toBe('Second card');
    press('ArrowRight');
    expect(title()).toBe('Third card');
    fail(false);
    await vi.waitFor(() => {
      flushSync();
      expect(document.querySelector('.chip:disabled')).toBeNull();
    });
    expect(title()).toBe('Third card');
  });

  it('says Inbox zero only when the whole inbox is empty', async () => {
    // A card that synced in after the panel opened isn't in its queue.
    const late = note('late', 'Arrived later');
    (sortedItems as unknown as Writable<InboxItem[]>).update((l) => [
      ...l,
      late,
    ]);
    for (let i = 0; i < 3; i++) {
      press('a');
      await settle();
    }
    await vi.waitFor(() => {
      flushSync();
      expect(document.querySelector('.finished-title')?.textContent).toBe(
        'That’s the lot',
      );
    });
  });

  it('stays on the card when the action fails', async () => {
    actions.archiveFromInbox.mockResolvedValueOnce(false);
    press('a');
    await settle();
    expect(title()).toBe('First card');
  });

  it('shows the grid’s warning line', () => {
    press('j');
    press('j');
    expect(document.querySelector('.triage .flag')?.textContent).toContain(
      'No title',
    );
  });

  it('leaves keys alone while a dialog is open on top', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    press('a');
    press('Escape');
    expect(actions.archiveFromInbox).not.toHaveBeenCalled();
    expect(onclose).not.toHaveBeenCalled();
  });

  it('opens the card and closes on Escape', () => {
    press('o');
    expect(onopen).toHaveBeenCalledWith(cards[0]);
    press('Escape');
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('wraps up when the queue runs out', async () => {
    press('j');
    press('a');
    await settle();
    press('a');
    await vi.waitFor(() => {
      flushSync();
      expect(document.querySelector('.finished')?.textContent).toContain(
        '2 cards sorted',
      );
    });
    expect(document.querySelector('.finished')?.textContent).toContain(
      '1 skipped card is still waiting',
    );
    const again = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Go round again',
    );
    again?.click();
    flushSync();
    expect(title()).toBe('First card');
  });
});
