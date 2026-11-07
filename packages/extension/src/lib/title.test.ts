import { describe, expect, it } from 'vitest';
import { recognisableTitle } from './title';

describe('recognisableTitle', () => {
  const url = 'https://www.example.com/articles/foo/';

  it('uses the first non-blank candidate', () => {
    expect(recognisableTitle(url, '  ', undefined, 'Tab title')).toBe(
      'Tab title',
    );
  });

  it('skips a candidate that is just the URL', () => {
    expect(recognisableTitle(url, url, 'Link text')).toBe('Link text');
  });

  it('falls back to host + path, not the raw URL', () => {
    expect(recognisableTitle(url, '')).toBe('example.com/articles/foo');
    expect(recognisableTitle('https://example.com/')).toBe('example.com');
  });

  it('returns unparseable input as-is', () => {
    expect(recognisableTitle('not a url')).toBe('not a url');
  });
});
