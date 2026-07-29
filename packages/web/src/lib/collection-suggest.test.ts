import { describe, expect, it } from 'vitest';
import type { Collection, InboxItem } from '@inbox-rs/rs-module';
import { suggestCollections } from './collection-suggest';

function col(id: string, name: string, itemIds: string[] = []): Collection {
  return { id, name, itemIds, createdAt: '2026-01-01T00:00:00Z' };
}

function bookmark(
  id: string,
  url: string,
  title = 'A bookmark',
  collectionId?: string,
): InboxItem {
  return {
    id,
    type: 'bookmark',
    title,
    url,
    createdAt: '2026-01-01T00:00:00Z',
    ...(collectionId ? { collectionId } : {}),
  } as InboxItem;
}

function note(id: string, title: string, description?: string): InboxItem {
  return {
    id,
    type: 'note',
    title,
    body: '',
    ...(description ? { description } : {}),
    createdAt: '2026-01-01T00:00:00Z',
  } as InboxItem;
}

describe('suggestCollections', () => {
  it('suggests a collection already holding the same domain', () => {
    const existing = bookmark('b1', 'https://blog.rust-lang.org/old-post');
    const target = bookmark('b2', 'https://www.rust-lang.org/new');
    const rust = col('c1', 'Rust', ['b1']);
    const web = col('c2', 'Web');

    const result = suggestCollections(
      target,
      [rust, web],
      { b1: existing },
      [],
    );
    // www. is stripped but subdomains are respected: blog.rust-lang.org and
    // rust-lang.org are different sites, so only an exact domain repeat hits.
    expect(result).toEqual([]);

    const sameDomain = bookmark('b3', 'https://blog.rust-lang.org/another');
    const result2 = suggestCollections(
      sameDomain,
      [rust, web],
      { b1: existing },
      [],
    );
    expect(result2).toEqual([{ collection: rust, reason: 'site' }]);
  });

  it('does not let the item match its own domain footprint', () => {
    const self = bookmark('b1', 'https://example.com/a', 'Example', 'c1');
    const other = col('c2', 'Other', ['b1']);
    // b1 is in c2's itemIds but is the item being filed — no self-match.
    expect(suggestCollections(self, [other], { b1: self }, [])).toEqual([]);
  });

  it('matches collection names as whole words in title/description', () => {
    const recipes = col('c1', 'Recipes');
    const rust = col('c2', 'Rust');
    const item = note('n1', 'Weeknight recipes to try', 'crusty bread ideas');

    const result = suggestCollections(item, [recipes, rust], {}, []);
    // "crusty" must NOT match "Rust" — word boundaries are required.
    expect(result).toEqual([{ collection: recipes, reason: 'name' }]);
  });

  it('fills remaining slots from recency, newest first, without duplicates', () => {
    const a = col('a', 'Alpha');
    const b = col('b', 'Beta');
    const c = col('c', 'Gamma');
    const item = note('n1', 'Beta test notes');

    const result = suggestCollections(item, [a, b, c], {}, ['b', 'c', 'a']);
    expect(result.map((s) => [s.collection.id, s.reason])).toEqual([
      ['b', 'name'], // content match wins the top slot
      ['c', 'recent'],
      ['a', 'recent'],
    ]);
  });

  it('never suggests the collection the item is already in', () => {
    const home = col('c1', 'Reading');
    const item = { ...note('n1', 'Reading list'), collectionId: 'c1' };
    expect(suggestCollections(item, [home], {}, ['c1'])).toEqual([]);
  });

  it('caps results at max', () => {
    const cols = ['a', 'b', 'c', 'd'].map((id) => col(id, id.toUpperCase()));
    const item = note('n1', 'untitled');
    const result = suggestCollections(item, cols, {}, ['a', 'b', 'c', 'd']);
    expect(result).toHaveLength(3);
  });
});
