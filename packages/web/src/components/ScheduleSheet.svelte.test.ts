// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { storeItem } = vi.hoisted(() => ({
  storeItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/stores', () => ({
  storeItem,
  setItemPlan: vi.fn().mockResolvedValue(undefined),
}));

import type { NoteItem } from '@inbox-rs/rs-module';
import ScheduleSheet from './ScheduleSheet.svelte';

const conf: NoteItem = {
  id: 'n1',
  type: 'note',
  title: 'Conf',
  body: '',
  createdAt: '2026-07-01T00:00:00Z',
  scheduleKind: 'event',
  allDay: true,
  startsAt: new Date(2026, 10, 9).toISOString(),
  endsAt: new Date(2026, 10, 11).toISOString(),
};

let cmp: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = undefined;
  document.body.innerHTML = '';
  storeItem.mockClear();
});

function open(item: NoteItem) {
  cmp = mount(ScheduleSheet, {
    target: document.body,
    props: { item, onclose: () => {} },
  });
  flushSync();
  return document.getElementById('schedule-ends') as HTMLInputElement | null;
}

async function save() {
  const btn = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Update time',
  ) as HTMLButtonElement;
  btn.click();
  await vi.waitFor(() => expect(storeItem).toHaveBeenCalled());
  return storeItem.mock.calls[0][0] as NoteItem;
}

describe('ScheduleSheet all-day end', () => {
  it('shows a labelled Ends date seeded from the stored span, and keeps it on re-save', async () => {
    const ends = open(conf);
    expect(ends?.labels?.[0]?.textContent).toBe('Ends');
    expect(ends?.value).toBe('2026-11-11');
    expect((await save()).endsAt).toBe(conf.endsAt);
  });

  it('defaults Ends to the start date and saves a new span', async () => {
    const ends = open({ ...conf, endsAt: undefined })!;
    expect(ends.value).toBe('2026-11-09');
    ends.value = '2026-11-12';
    ends.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect((await save()).endsAt).toBe(new Date(2026, 10, 12).toISOString());
  });

  it('blocks saving an end before the start', () => {
    const ends = open(conf)!;
    ends.value = '2026-11-08';
    ends.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const btn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Update time',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(ends.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('schedule-ends-error')?.textContent).toBe(
      'Ends before it starts',
    );
  });

  it('is hidden for timed events', () => {
    expect(open({ ...conf, allDay: undefined, endsAt: undefined })).toBeNull();
  });
});
