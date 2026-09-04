import { describe, expect, it } from 'vitest';
import { noteTitleFromBody } from './note-title.js';

describe('noteTitleFromBody', () => {
  it('caps a single-line title at 50 characters', () => {
    expect(noteTitleFromBody('a'.repeat(80))).toBe('a'.repeat(50));
  });

  it.each(['\n', '\r\n', '\r'])('stops at a %j line ending', (lineEnding) => {
    expect(noteTitleFromBody(`a short title${lineEnding}more text`)).toBe(
      'a short title',
    );
  });
});
