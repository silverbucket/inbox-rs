import type { InboxItem, TodoItem } from '@inbox-rs/rs-module';
import { describe, expect, it } from 'vitest';
import {
  ALERT_GRACE_MS,
  ALL_DAY_ALERT_HOUR,
  alertKey,
  alertTimeFor,
  collectDueAlerts,
  eligibleForAlert,
  pruneFiredKeys,
} from './alerts-core';

function todo(id: string, overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id,
    type: 'todo',
    title: id,
    completed: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    scheduleKind: 'task',
    ...overrides,
  } as TodoItem;
}

const NOW = new Date('2026-08-04T12:00:00').getTime();

describe('alertTimeFor', () => {
  it('uses the exact startsAt moment for timed items', () => {
    const t = todo('a', { startsAt: '2026-08-04T13:30:00.000Z' });
    expect(alertTimeFor(t)).toBe(
      new Date('2026-08-04T13:30:00.000Z').getTime(),
    );
  });

  it(`resolves all-day items to ${ALL_DAY_ALERT_HOUR}:00 local on their day`, () => {
    const t = todo('a', { startsAt: '2026-08-04T00:00:00', allDay: true });
    const expected = new Date('2026-08-04T00:00:00');
    expected.setHours(ALL_DAY_ALERT_HOUR, 0, 0, 0);
    expect(alertTimeFor(t)).toBe(expected.getTime());
  });

  it('returns null without a startsAt or for an unparseable one', () => {
    expect(alertTimeFor(todo('a'))).toBeNull();
    expect(alertTimeFor(todo('a', { startsAt: 'not-a-date' }))).toBeNull();
  });
});

describe('eligibleForAlert', () => {
  const base = { startsAt: '2026-08-04T13:00:00.000Z' };

  it('accepts an open, unposted, scheduled item', () => {
    expect(eligibleForAlert(todo('a', base))).toBe(true);
  });

  it('rejects completed, archived (moved), and unscheduled items', () => {
    expect(eligibleForAlert(todo('a', { ...base, completed: true }))).toBe(
      false,
    );
    expect(eligibleForAlert(todo('a', { ...base, archived: true }))).toBe(
      false,
    );
    expect(eligibleForAlert(todo('a'))).toBe(false);
  });

  it('accepts calendar copies — a copy with a time alerts like anything else', () => {
    expect(
      eligibleForAlert(todo('a', { ...base, eventUrl: 'https://cal/x.ics' })),
    ).toBe(true);
  });
});

describe('collectDueAlerts', () => {
  it('fires due items within the grace window, oldest due first', () => {
    const items = [
      todo('late', { startsAt: new Date(NOW - 60_000).toISOString() }),
      todo('later', { startsAt: new Date(NOW - 10_000).toISOString() }),
      todo('future', { startsAt: new Date(NOW + 60_000).toISOString() }),
    ];
    const { fire, expire } = collectDueAlerts(items, new Set(), NOW);
    expect(fire.map((i) => i.id)).toEqual(['late', 'later']);
    expect(expire).toEqual([]);
  });

  it('expires items due before the grace window instead of firing', () => {
    const stale = todo('stale', {
      startsAt: new Date(NOW - ALERT_GRACE_MS - 1000).toISOString(),
    });
    const { fire, expire } = collectDueAlerts([stale], new Set(), NOW);
    expect(fire).toEqual([]);
    expect(expire).toEqual([alertKey(stale)]);
  });

  it('skips already-fired keys, and a moved time re-arms', () => {
    const t = todo('a', { startsAt: new Date(NOW - 5_000).toISOString() });
    const fired = new Set([alertKey(t)]);
    expect(collectDueAlerts([t], fired, NOW).fire).toEqual([]);

    const moved = { ...t, startsAt: new Date(NOW - 1_000).toISOString() };
    expect(collectDueAlerts([moved], fired, NOW).fire.map((i) => i.id)).toEqual(
      ['a'],
    );
  });

  it('re-arms when allDay flips with an unchanged startsAt — the effective time moved', () => {
    const t = todo('a', { startsAt: new Date(NOW - 5_000).toISOString() });
    const fired = new Set([alertKey(t)]);
    const flipped = { ...t, allDay: true };
    expect(alertKey(flipped)).not.toBe(alertKey(t));
    // The 09:00 all-day alert is its own key, so the timed alert's fired
    // entry no longer suppresses it (generous grace keeps it in `fire`).
    const { fire } = collectDueAlerts([flipped], fired, NOW, 12 * 60 * 60_000);
    expect(fire.map((i) => i.id)).toEqual(['a']);
  });

  it('ignores ineligible items even when due', () => {
    const moved = todo('moved', {
      startsAt: new Date(NOW - 5_000).toISOString(),
      eventUrl: 'https://cal/x.ics',
      archived: true,
    });
    const { fire, expire } = collectDueAlerts([moved], new Set(), NOW);
    expect(fire).toEqual([]);
    expect(expire).toEqual([]);
  });
});

describe('pruneFiredKeys', () => {
  it('keeps keys for live items with an unchanged recent schedule', () => {
    const t = todo('a', { startsAt: new Date(NOW - 60_000).toISOString() });
    const items: Record<string, InboxItem> = { a: t };
    expect(pruneFiredKeys([alertKey(t)], items, NOW)).toEqual([alertKey(t)]);
  });

  it('drops keys for deleted items, rescheduled items, old alerts, and junk', () => {
    const rearmed = todo('b', { startsAt: new Date(NOW).toISOString() });
    const ancient = todo('c', {
      startsAt: new Date(NOW - 8 * 24 * 60 * 60_000).toISOString(),
    });
    const items: Record<string, InboxItem> = { b: rearmed, c: ancient };
    const keys = [
      'gone@2026-08-04T00:00:00.000Z',
      `b@${new Date(NOW - 60_000).getTime()}`, // old effective time, item moved on
      alertKey(ancient),
      'no-separator',
    ];
    expect(pruneFiredKeys(keys, items, NOW)).toEqual([]);
  });
});
