import type { BookmarkItem, InboxItem } from '@inbox-rs/rs-module';
import { describe, expect, it } from 'vitest';
import { linkNote } from './link-note';

const link = (body?: string): BookmarkItem => ({
  id: 'bm-1',
  type: 'bookmark',
  title: 'Example',
  url: 'https://example.com',
  description: 'The page describing itself',
  createdAt: '2026-04-01T00:00:00.000Z',
  ...(body === undefined ? {} : { body }),
});

describe('linkNote', () => {
  it('returns the first line of the note written on a link', () => {
    expect(linkNote(link('Ask Sam about this\nmore detail below'))).toBe(
      'Ask Sam about this',
    );
  });

  it('is null for a link with no note, whatever its description', () => {
    expect(linkNote(link())).toBeNull();
    expect(linkNote(link('  \n\n'))).toBeNull();
  });

  it('skips blank lines, rules and code fences to reach the first words', () => {
    expect(linkNote(link('\n---\n```js\nconst a = 1;\n```'))).toBe(
      'const a = 1;',
    );
  });

  it('shows markdown as plain text', () => {
    expect(
      linkNote(link('## Read **before** the [demo](https://x.test)')),
    ).toBe('Read before the demo');
    expect(linkNote(link('- [ ] *check* `pricing`'))).toBe('check pricing');
    expect(linkNote(link('> quoted from the page'))).toBe(
      'quoted from the page',
    );
  });

  it('cuts a very long first line', () => {
    expect(linkNote(link('x'.repeat(200)))).toBe(`${'x'.repeat(160)}…`);
  });

  it('is only for links: a note card already shows its own text', () => {
    const note: InboxItem = {
      id: 'n-1',
      type: 'note',
      title: 'Note',
      body: 'Body content',
      createdAt: '2026-04-01T00:00:00.000Z',
    };
    expect(linkNote(note)).toBeNull();
  });
});
