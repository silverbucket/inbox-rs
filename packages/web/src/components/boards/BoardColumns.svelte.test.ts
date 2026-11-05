// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/board-actions', () => ({
  addToColumn: vi.fn().mockResolvedValue(undefined),
  moveItemToColumn: vi.fn().mockResolvedValue(undefined),
  updateColumns: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../lib/schedule-sync', () => ({
  setItemCompleted: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../lib/toast', () => ({ showToast: vi.fn() }));

import type { Collection, ColumnSet, InboxItem } from '@inbox-rs/rs-module';
import {
  addToColumn,
  moveItemToColumn,
  updateColumns,
} from '../../lib/board-actions';
import { BOARD_UNSORTED } from '../../lib/boards';
import { setItemCompleted } from '../../lib/schedule-sync';
import BoardColumns from './BoardColumns.svelte';

const set: ColumnSet = {
  id: 'pipe',
  name: 'Pipeline',
  createdAt: '',
  columns: [
    { id: BOARD_UNSORTED, name: 'Unsorted', color: '#8a8378' },
    { id: 'idea', name: 'Idea', color: '#7c3aed' },
    { id: 'ship', name: 'Shipped', color: '#0f766e', done: true },
  ],
};
const a = { id: 'a', name: 'Alpha', createdAt: '' } as Collection;
const b = { id: 'b', name: 'Beta', createdAt: '' } as Collection;
const item = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'note',
    title: id,
    body: '',
    createdAt: '2026-11-01T00:00:00.000Z',
    collectionId: 'a',
    ...extra,
  }) as unknown as InboxItem;

describe('BoardColumns', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  function render(items: InboxItem[], extra: Record<string, unknown> = {}) {
    component = mount(BoardColumns, {
      target: host,
      props: {
        set,
        items,
        lookupCollection: (id: string | undefined) =>
          id === 'a' ? a : id === 'b' ? b : null,
        addTargets: [a],
        onselect: vi.fn(),
        ...extra,
      },
    });
    flushSync();
  }

  const column = (name: string) =>
    [...host.querySelectorAll('section')].find(
      (s) => s.querySelector('h3')?.textContent === name,
    ) as HTMLElement;
  const titles = (name: string) =>
    [...column(name).querySelectorAll('li')].map((li) =>
      li.textContent?.includes('idea-note') ? 'idea-note' : li.textContent,
    );

  it('places cards in their columns, completed todos in done', () => {
    render([
      item('idea-note', { boardColumns: { pipe: 'idea' } }),
      item('loose'),
      item('t', { isTodo: true, completed: true }),
    ]);
    expect(column('Idea').querySelectorAll('li')).toHaveLength(1);
    expect(titles('Idea')).toEqual(['idea-note']);
    expect(column('Unsorted').textContent).toContain('loose');
    expect(column('Shipped').textContent).toContain('t');
  });

  it('moves a card with its Move to menu', () => {
    const card = item('loose');
    render([card]);
    const select = column('Unsorted').querySelector(
      'li select',
    ) as HTMLSelectElement;
    select.value = 'idea';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(moveItemToColumn).toHaveBeenCalledWith(card, set, 'idea');
  });

  it('toggles a todo from its checkbox', () => {
    const t = item('t', { isTodo: true, completed: false });
    render([t]);
    (
      host.querySelector('[aria-label="Complete t"]') as HTMLButtonElement
    ).click();
    expect(setItemCompleted).toHaveBeenCalledWith(t, true);
  });

  it('adds a card to a column, asking which collection when several', async () => {
    render([], { addTargets: [a, b] });
    (
      [...column('Idea').querySelectorAll('button')].find((x) =>
        x.textContent?.includes('Add to Idea'),
      ) as HTMLButtonElement
    ).click();
    flushSync();
    const input = host.querySelector(
      '[aria-label="New card in Idea"]',
    ) as HTMLInputElement;
    input.value = 'New thing';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const pick = host.querySelector(
      '[aria-label="Collection for the new card"]',
    ) as HTMLSelectElement;
    pick.value = 'b';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    (host.querySelector('form.add-form') as HTMLFormElement).requestSubmit();
    await Promise.resolve();
    expect(addToColumn).toHaveBeenCalledWith(
      'b',
      set,
      'idea',
      'New thing',
      false,
    );
  });

  it('adds a column when allowed', async () => {
    render([], { canAddColumns: true });
    (
      [...host.querySelectorAll('button')].find((x) =>
        /add column/i.test(x.textContent ?? ''),
      ) as HTMLButtonElement
    ).click();
    flushSync();
    const input = host.querySelector(
      '[aria-label="New column name"]',
    ) as HTMLInputElement;
    input.value = 'Review';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    (host.querySelector('.add-column form') as HTMLFormElement).requestSubmit();
    await Promise.resolve();
    const cols = vi.mocked(updateColumns).mock.calls[0][1];
    expect(cols.map((c) => c.name)).toEqual([
      'Unsorted',
      'Idea',
      'Shipped',
      'Review',
    ]);
  });
});
