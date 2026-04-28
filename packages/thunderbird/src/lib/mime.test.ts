import { describe, it, expect } from 'vitest';
import { extractTextBody } from './mime';

/**
 * `extractTextBody` walks a `messenger.messages.MessagePart` tree, prefers
 * `text/plain`, and falls back to a tag-stripped `text/html`. Tests build
 * minimal part shapes that match the ambient `messenger` typings without
 * needing the real Thunderbird API.
 */

function part(contentType: string, body?: string, parts?: any[]): any {
  return { contentType, body, parts };
}

describe('extractTextBody', () => {
  it('returns the text/plain body when present at the root', () => {
    expect(extractTextBody(part('text/plain', 'Hello'))).toBe('Hello');
  });

  it('finds text/plain nested inside a multipart tree', () => {
    const tree = part('multipart/alternative', undefined, [
      part('text/html', '<p>html version</p>'),
      part('text/plain', 'plain version'),
    ]);
    expect(extractTextBody(tree)).toBe('plain version');
  });

  it('prefers text/plain over text/html when both exist', () => {
    const tree = part('multipart/alternative', undefined, [
      part('text/plain', 'plain wins'),
      part('text/html', '<p>html loses</p>'),
    ]);
    expect(extractTextBody(tree)).toBe('plain wins');
  });

  it('falls back to text/html with tag stripping when plain is absent', () => {
    const tree = part('multipart/alternative', undefined, [
      part('text/html', '<p>Hello <strong>world</strong></p>'),
    ]);
    expect(extractTextBody(tree)).toBe('Hello world');
  });

  it('strips <script> and <style> blocks entirely', () => {
    const html =
      '<style>.x{color:red}</style><script>alert(1)</script><p>Body text</p>';
    expect(extractTextBody(part('text/html', html))).toBe('Body text');
  });

  it('decodes common HTML entities', () => {
    const html = '<p>5 &lt; 10 &amp; 20 &gt; 5 &quot;quoted&quot;&nbsp;text</p>';
    expect(extractTextBody(part('text/html', html))).toBe('5 < 10 & 20 > 5 "quoted" text');
  });

  it('converts <br> and </p> to newlines', () => {
    const html = '<p>line1</p><p>line2</p>line3<br>line4';
    expect(extractTextBody(part('text/html', html))).toBe('line1\n\nline2\n\nline3\nline4');
  });

  it('collapses runs of 3+ newlines to a single blank-line separator', () => {
    const html = '<p>a</p><br><br><br><br><p>b</p>';
    const result = extractTextBody(part('text/html', html));
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('returns empty string when no text part exists', () => {
    const tree = part('multipart/mixed', undefined, [
      part('image/png'),
      part('application/octet-stream'),
    ]);
    expect(extractTextBody(tree)).toBe('');
  });

  it('returns empty string when text part has no body', () => {
    expect(extractTextBody(part('text/plain', undefined))).toBe('');
  });

  it('handles deeply nested message structures', () => {
    const tree = part('multipart/mixed', undefined, [
      part('multipart/related', undefined, [
        part('multipart/alternative', undefined, [
          part('text/html', '<p>html</p>'),
          part('text/plain', 'deep plain'),
        ]),
      ]),
    ]);
    expect(extractTextBody(tree)).toBe('deep plain');
  });
});
