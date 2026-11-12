import type { Collection, InboxItem } from '@inbox-rs/rs-module';
import { describe, expect, it } from 'vitest';
import { compareRows, outsideInbox, whereLabel } from './duplicate-compare';
import { findDuplicates } from './triage';

const bookmark = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'bookmark',
    title: 'A page',
    url: 'https://example.org/post',
    createdAt: '2026-11-04T09:00:00Z',
    ...extra,
  }) as unknown as InboxItem;

const collections = {
  reading: { id: 'reading', name: 'Reading List', itemIds: [] },
  old: { id: 'old', name: 'Old', itemIds: [], archived: true },
} as unknown as Record<string, Collection>;

const byId = (list: InboxItem[]) =>
  Object.fromEntries(list.map((i) => [i.id, i]));

describe('duplicates outside the inbox', () => {
  it('flags an inbox card that repeats a filed one, never the filed card', () => {
    const inbox = bookmark('a');
    const filed = bookmark('b', { collectionId: 'reading' });
    const dups = findDuplicates(
      [inbox],
      outsideInbox(byId([inbox, filed]), collections),
    );
    expect(dups.get('a')?.map((i) => i.id)).toEqual(['b']);
    expect(dups.has('b')).toBe(false);
  });

  it('leaves out archived copies and copies in an archived collection', () => {
    const all = byId([
      bookmark('a'),
      bookmark('b', { collectionId: 'reading', archived: true }),
      bookmark('c', { collectionId: 'old' }),
      bookmark('d', { archived: true }),
    ]);
    expect(outsideInbox(all, collections)).toEqual([]);
  });

  it('returns every copy when three or more match', () => {
    const a = bookmark('a');
    const b = bookmark('b');
    const c = bookmark('c', { collectionId: 'reading' });
    const dups = findDuplicates([a, b], [c]);
    expect(dups.get('a')?.map((i) => i.id)).toEqual(['b', 'c']);
    expect(dups.get('b')?.map((i) => i.id)).toEqual(['a', 'c']);
  });
});

describe('compareRows', () => {
  it('names where each copy is and marks the facts that differ', () => {
    const inbox = bookmark('a');
    const filed = bookmark('b', {
      collectionId: 'reading',
      notes: 'Read **before** Friday',
      pinned: true,
    });
    const rows = compareRows([inbox, filed], collections);
    const row = (key: string) => rows.find((r) => r.key === key);
    expect(row('where')).toMatchObject({
      values: ['Inbox', 'Reading List'],
      differs: true,
    });
    expect(row('title')?.differs).toBe(false);
    expect(row('notes')).toMatchObject({
      values: ['', 'Read before Friday'],
      differs: true,
    });
    expect(row('important')?.values).toEqual(['', 'Yes']);
    // Nothing to say about a fact no copy has.
    expect(row('scheduled')).toBeUndefined();
    // Two saves never share a time; that isn't worth highlighting.
    expect(row('saved')?.differs).toBe(false);
  });

  it('marks long notes that only differ past where they are cut off', () => {
    const long = 'word '.repeat(60);
    const rows = compareRows(
      [
        bookmark('a', { notes: `${long}one` }),
        bookmark('b', { notes: `${long}two` }),
      ],
      collections,
    );
    const notes = rows.find((r) => r.key === 'notes');
    expect(notes?.values[0]).toBe(notes?.values[1]);
    expect(notes?.differs).toBe(true);
  });

  it('calls an unfiled todo by its page', () => {
    expect(whereLabel(bookmark('a', { isTodo: true }), collections)).toBe(
      'Todos',
    );
  });
});
