import { describe, expect, it } from 'vitest';
import {
  itemHref,
  itemIdFromHref,
  itemLinkMarkdown,
  matchItemLinkTrigger,
} from './item-links';

describe('item link addresses', () => {
  it('round-trips an id through its href', () => {
    expect(itemHref('abc-123')).toBe('#/item/abc-123');
    expect(itemIdFromHref('#/item/abc-123')).toBe('abc-123');
    const odd = 'a (b)/c d';
    expect(itemHref(odd)).not.toMatch(/[() ]/);
    expect(itemIdFromHref(itemHref(odd))).toBe(odd);
  });

  it('rejects anything that is not an item address', () => {
    for (const href of [
      null,
      '',
      '#/item/',
      '#/items/x',
      '#/collection/x',
      'https://example.com/#/item/x',
      '#/item/%',
    ]) {
      expect(itemIdFromHref(href)).toBeNull();
    }
  });
});

describe('itemLinkMarkdown', () => {
  it('writes a plain markdown link', () => {
    expect(itemLinkMarkdown('Trip plan', 'id1')).toBe(
      '[Trip plan](#/item/id1)',
    );
  });

  it('keeps brackets and line breaks in a title from breaking the link', () => {
    expect(itemLinkMarkdown('a [b]\nc', 'id1')).toBe(
      '[a \\[b\\] c](#/item/id1)',
    );
    expect(itemLinkMarkdown('  ', 'id1')).toBe('[Untitled](#/item/id1)');
  });
});

describe('matchItemLinkTrigger', () => {
  it('matches an open [[ up to the cursor', () => {
    expect(matchItemLinkTrigger('see [[')).toEqual({ query: '', length: 2 });
    expect(matchItemLinkTrigger('see [[trip pl')).toEqual({
      query: 'trip pl',
      length: 9,
    });
  });

  it('ignores closed brackets, single brackets and text after a link', () => {
    expect(matchItemLinkTrigger('see [trip')).toBeNull();
    expect(matchItemLinkTrigger('see [[trip]] and')).toBeNull();
    expect(matchItemLinkTrigger('[[a￼ b')).toBeNull();
    expect(matchItemLinkTrigger('plain text')).toBeNull();
  });
});
