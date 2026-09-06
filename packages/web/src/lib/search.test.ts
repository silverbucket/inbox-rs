import type { Collection, InboxItem } from '@inbox-rs/rs-module';
import { describe, expect, it } from 'vitest';
import {
  isTodoLike,
  normalize,
  parseQuery,
  scoreFields,
  searchFields,
  searchItems,
  searchItemsWithTerms,
} from './search';

function note(
  id: string,
  title: string,
  body = '',
  extra: Partial<InboxItem> = {},
): InboxItem {
  return {
    id,
    type: 'note',
    title,
    body,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  } as InboxItem;
}

describe('normalize', () => {
  it('lowercases and strips accents', () => {
    expect(normalize('Café Ünïcode')).toBe('cafe unicode');
  });

  it('collapses whitespace runs including newlines', () => {
    expect(normalize('foo \n  bar\tbaz')).toBe('foo bar baz');
  });
});

describe('parseQuery', () => {
  it('splits on whitespace and normalizes', () => {
    expect(parseQuery('  Foo   BAR ')).toEqual(['foo', 'bar']);
  });

  it('keeps quoted phrases as one term', () => {
    expect(parseQuery('"read later" tonight')).toEqual([
      'read later',
      'tonight',
    ]);
  });

  it('drops an unbalanced quote but keeps its words', () => {
    expect(parseQuery('"abc def')).toEqual(['abc', 'def']);
    expect(parseQuery('abc"')).toEqual(['abc']);
  });

  it('ignores empty quotes and blank input', () => {
    expect(parseQuery('""')).toEqual([]);
    expect(parseQuery('   ')).toEqual([]);
    expect(parseQuery('')).toEqual([]);
  });
});

describe('searchFields', () => {
  it('folds in the optional per-type fields that exist', () => {
    const bookmark: InboxItem = {
      id: 'b',
      type: 'bookmark',
      title: 'A Post',
      description: 'Desc',
      url: 'https://Example.com/Post',
      siteName: 'Example',
      body: 'excerpt',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const fields = searchFields(bookmark);
    expect(fields.title).toBe('a post');
    expect(fields.text).toEqual(['desc', 'excerpt', 'example']);
    expect(fields.url).toEqual(['https://example.com/post']);
  });

  it('includes the collection name and email sender', () => {
    const email: InboxItem = {
      id: 'e',
      type: 'email',
      title: 'Re: invoice',
      body: 'see attached',
      from: 'Ann <ann@example.org>',
      notes: 'pay by friday',
      collectionId: 'c1',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const collection: Collection = {
      id: 'c1',
      name: 'Finance',
      itemIds: ['e'],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    expect(searchFields(email, collection).text).toEqual([
      'see attached',
      'pay by friday',
      'ann <ann@example.org>',
      'finance',
    ]);
  });

  it('tolerates a missing title', () => {
    const item = {
      ...note('x', 'y'),
      title: undefined,
    } as unknown as InboxItem;
    expect(searchFields(item).title).toBe('');
  });
});

describe('scoreFields', () => {
  it('requires every term to match', () => {
    const fields = searchFields(note('a', 'Groceries', 'milk and eggs'));
    expect(scoreFields(fields, ['milk'])).toBeGreaterThan(0);
    expect(scoreFields(fields, ['milk', 'bread'])).toBe(0);
  });

  it('ranks title over body over url', () => {
    const terms = ['rust'];
    const inTitle = searchFields(note('a', 'Learning rust'));
    const inBody = searchFields(note('b', 'Languages', 'rust and go'));
    const inUrl = searchFields({
      id: 'c',
      type: 'bookmark',
      title: 'Homepage',
      url: 'https://rust-lang.org',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const t = scoreFields(inTitle, terms);
    const b = scoreFields(inBody, terms);
    const u = scoreFields(inUrl, terms);
    expect(t).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(u);
    expect(u).toBeGreaterThan(0);
  });

  it('prefers a title match at a word start', () => {
    const terms = ['art'];
    const wordStart = scoreFields(searchFields(note('a', 'Modern art')), terms);
    const midWord = scoreFields(searchFields(note('b', 'Startup')), terms);
    expect(wordStart).toBeGreaterThan(midWord);
    expect(midWord).toBeGreaterThan(0);
  });
});

describe('searchItems', () => {
  const items: InboxItem[] = [
    note('old', 'Rust book notes', 'ownership', {
      createdAt: '2025-06-01T00:00:00.000Z',
    }),
    note('new', 'Rust talk', 'borrow checker', {
      createdAt: '2026-03-01T00:00:00.000Z',
    }),
    note('body', 'Conference', 'a talk about rust'),
    note('miss', 'Gardening', 'tomatoes'),
    {
      id: 'todo',
      type: 'todo',
      title: 'Finish rust chapter',
      completed: true,
      createdAt: '2026-02-01T00:00:00.000Z',
    },
  ];

  it('returns nothing for an empty query', () => {
    expect(searchItems(items, '')).toEqual([]);
    expect(searchItems(items, '  ')).toEqual([]);
    expect(searchItemsWithTerms(items, [])).toEqual([]);
  });

  it('gives the same results for pre-parsed terms', () => {
    expect(searchItemsWithTerms(items, parseQuery('rust talk'))).toEqual(
      searchItems(items, 'rust talk'),
    );
  });

  it('matches across title and body, excluding non-matches', () => {
    const ids = searchItems(items, 'rust').map((r) => r.item.id);
    expect(ids).toContain('old');
    expect(ids).toContain('new');
    expect(ids).toContain('body');
    expect(ids).toContain('todo');
    expect(ids).not.toContain('miss');
  });

  it('sorts by score then newest first', () => {
    const ids = searchItems(items, 'rust').map((r) => r.item.id);
    // Three title matches share a score; newest of those first. The
    // body-only match trails.
    expect(ids).toEqual(['new', 'todo', 'old', 'body']);
  });

  it('is accent- and case-insensitive both ways', () => {
    const accented = [note('a', 'Café list'), note('b', 'cafe list')];
    expect(searchItems(accented, 'CAFÉ').map((r) => r.item.id)).toEqual([
      'a',
      'b',
    ]);
    expect(searchItems(accented, 'cafe')).toHaveLength(2);
  });

  it('matches quoted phrases verbatim and across line breaks', () => {
    const phrased = [
      note('hit', 'x', 'read\nlater tonight'),
      note('scattered', 'later', 'read something'),
    ];
    expect(searchItems(phrased, '"read later"').map((r) => r.item.id)).toEqual([
      'hit',
    ]);
    expect(searchItems(phrased, 'read later')).toHaveLength(2);
  });

  it('finds items by the name of their collection', () => {
    const filed = [note('f', 'Untitled', '', { collectionId: 'c1' })];
    const collections: Record<string, Collection> = {
      c1: {
        id: 'c1',
        name: 'Reading list',
        itemIds: ['f'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    };
    expect(searchItems(filed, 'reading', collections)).toHaveLength(1);
    expect(searchItems(filed, 'reading')).toHaveLength(0);
  });
});

describe('isTodoLike', () => {
  it('covers both todo types and flagged references', () => {
    expect(isTodoLike(note('a', 'x'))).toBe(false);
    expect(isTodoLike(note('b', 'x', '', { isTodo: true }))).toBe(true);
    expect(
      isTodoLike({
        id: 't',
        type: 'todo',
        title: 'x',
        completed: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(true);
  });
});
