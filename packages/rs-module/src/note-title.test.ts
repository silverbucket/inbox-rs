import { describe, expect, it } from 'vitest';
import { noteTitleFromBody, truncateTitle } from './note-title.js';

describe('noteTitleFromBody', () => {
  it('caps a single-line title at 50 characters and marks the cut', () => {
    expect(noteTitleFromBody('a'.repeat(80))).toBe(`${'a'.repeat(50)}…`);
  });

  it('adds no ellipsis to a line that fits', () => {
    expect(noteTitleFromBody('a'.repeat(50))).toBe('a'.repeat(50));
  });

  it.each(['\n', '\r\n', '\r'])('stops at a %j line ending', (lineEnding) => {
    expect(noteTitleFromBody(`a short title${lineEnding}more text`)).toBe(
      'a short title',
    );
  });
});

describe('truncateTitle', () => {
  it('leaves short text alone', () => {
    expect(truncateTitle('short')).toBe('short');
  });

  it('cuts long text at 50 characters with an ellipsis', () => {
    expect(truncateTitle('b'.repeat(51))).toBe(`${'b'.repeat(50)}…`);
  });
});
