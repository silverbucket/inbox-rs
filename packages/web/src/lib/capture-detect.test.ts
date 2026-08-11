import { describe, expect, it } from 'vitest';
import {
  bookmarkUrlFromNoteBody,
  bookmarkUrlFromText,
  detectCaptureKind,
} from './capture-detect';

describe('detectCaptureKind', () => {
  it('treats empty / whitespace as empty', () => {
    expect(detectCaptureKind('').kind).toBe('empty');
    expect(detectCaptureKind('   \n ').kind).toBe('empty');
  });

  it('detects full http(s) URLs as bookmarks', () => {
    expect(detectCaptureKind('https://example.com')).toEqual({
      kind: 'bookmark',
      url: 'https://example.com',
    });
    expect(detectCaptureKind('http://example.com/a?b=1#c')).toEqual({
      kind: 'bookmark',
      url: 'http://example.com/a?b=1#c',
    });
  });

  it('detects bare dotted hosts as bookmarks, normalising to https', () => {
    expect(detectCaptureKind('github.com/x')).toEqual({
      kind: 'bookmark',
      url: 'https://github.com/x',
    });
    expect(detectCaptureKind('example.com')).toEqual({
      kind: 'bookmark',
      url: 'https://example.com',
    });
  });

  it('treats multi-token text (incl. text containing a URL) as a note', () => {
    expect(detectCaptureKind('check https://example.com out')).toEqual({
      kind: 'note',
      body: 'check https://example.com out',
    });
    expect(detectCaptureKind('buy milk')).toEqual({
      kind: 'note',
      body: 'buy milk',
    });
  });

  it('treats multi-line input as a note (preserving the raw body)', () => {
    expect(detectCaptureKind('line1\nline2')).toEqual({
      kind: 'note',
      body: 'line1\nline2',
    });
  });

  it('rejects non-dotted or non-TLD tokens (notes, not bookmarks)', () => {
    expect(detectCaptureKind('note').kind).toBe('note');
    expect(detectCaptureKind('v2.3').kind).toBe('note'); // last label not alphabetic
    expect(detectCaptureKind('1.2').kind).toBe('note');
  });

  it('only http/https schemes become bookmarks (security)', () => {
    expect(detectCaptureKind('mailto:a@b.com').kind).toBe('note');
    expect(detectCaptureKind('javascript:alert(1)').kind).toBe('note');
    expect(detectCaptureKind('ftp://x.com').kind).toBe('note');
  });

  it('documents the accepted tradeoff: a lone dotted token with an alpha TLD is a bookmark', () => {
    // e.g. someone types "file.txt" — becomes a bookmark; rare, and Undo covers it.
    expect(detectCaptureKind('file.txt').kind).toBe('bookmark');
  });
});

describe('bookmarkUrlFromText', () => {
  it('recognizes a URL-only legacy note, including X share parameters', () => {
    const url =
      'https://x.com/vivistac/status/2086480928591819162?s=46&t=UTd7gPLSy4yZR518MK49Qg';
    expect(bookmarkUrlFromText(url)).toBe(url);
  });

  it('does not offer bookmark conversion for prose containing a URL', () => {
    expect(bookmarkUrlFromText('remember https://example.com')).toBeNull();
  });
});

describe('bookmarkUrlFromNoteBody', () => {
  const url = 'https://x.com/nypost/status/2086887707624534318';

  it.each([
    url,
    `[${url}](${url})`,
    `<${url}>`,
    `<p><a href="${url}">${url}</a></p>`,
  ])('recovers a single rendered link from %s', (body) => {
    expect(bookmarkUrlFromNoteBody(body)).toBe(url);
  });

  it('rejects a link surrounded by actual note content', () => {
    expect(bookmarkUrlFromNoteBody(`Read this: [post](${url})`)).toBeNull();
  });

  it('preserves parenthesized segments in a Markdown link URL', () => {
    const parenthesizedUrl =
      'https://en.wikipedia.org/wiki/Function_(mathematics)';
    expect(bookmarkUrlFromNoteBody(`[Function](${parenthesizedUrl})`)).toBe(
      parenthesizedUrl,
    );
  });
});
