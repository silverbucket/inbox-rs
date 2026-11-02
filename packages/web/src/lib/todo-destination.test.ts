// @vitest-environment jsdom
import type { Collection, CollectionGroup } from '@inbox-rs/rs-module';
import { describe, expect, it } from 'vitest';
import { resolveTodoDestination } from './todo-destination';

const group = (id: string): CollectionGroup => ({
  id,
  name: id,
  collectionIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
});
const col = (id: string, groupId: string): Collection => ({
  id,
  name: id,
  groupId,
  itemIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
});

const work = group('work');
const home = group('home');
const road = col('road', 'work');
const hiring = col('hiring', 'work');
const garden = col('garden', 'home');
const all = [road, hiring, garden];

const resolve = (
  sections: { group: CollectionGroup; collections: Collection[] }[],
  remembered: string | null | undefined = undefined,
  recent: string[] = [],
) =>
  resolveTodoDestination({
    sections,
    allCollections: all,
    groupCount: 2,
    remembered,
    recent,
  });

const unfiltered = [
  { group: work, collections: [road, hiring] },
  { group: home, collections: [garden] },
];
const workOnly = [{ group: work, collections: [road, hiring] }];

describe('resolveTodoDestination', () => {
  it('is Unfiled when every group is hidden', () => {
    expect(resolve([], 'garden', ['garden'])).toBeUndefined();
  });

  it('is the sole visible collection, over anything remembered', () => {
    expect(resolve([{ group: home, collections: [garden] }], 'road')).toBe(
      'garden',
    );
    expect(resolve([{ group: home, collections: [garden] }], null)).toBe(
      'garden',
    );
  });

  it('honors the remembered pick while it is in view', () => {
    expect(resolve(unfiltered, 'garden')).toBe('garden');
    expect(resolve(workOnly, 'hiring')).toBe('hiring');
  });

  it('never resolves to a hidden collection', () => {
    expect(resolve(workOnly, 'garden', ['garden'])).not.toBe('garden');
  });

  it('prefers the most recently used visible collection under a filter', () => {
    expect(resolve(workOnly, 'garden', ['garden', 'hiring', 'road'])).toBe(
      'hiring',
    );
  });

  it('falls back to the first visible collection under a filter, never Unfiled', () => {
    expect(resolve(workOnly)).toBe('road');
    expect(resolve(workOnly, null)).toBe('road');
  });

  it('treats an individually hidden collection as a filter too', () => {
    const narrowed = [
      { group: work, collections: [hiring] },
      { group: home, collections: [garden] },
    ];
    expect(resolve(narrowed, 'road')).toBe('hiring');
  });

  it('is recency, then Unfiled, when nothing narrows the view', () => {
    expect(resolve(unfiltered, undefined, ['garden'])).toBe('garden');
    expect(resolve(unfiltered)).toBeUndefined();
  });

  it('keeps an explicit Unfiled when nothing narrows the view', () => {
    expect(resolve(unfiltered, null, ['garden'])).toBeUndefined();
  });
});
