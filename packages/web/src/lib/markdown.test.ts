// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('sanitizes raw html, inline handlers, and javascript urls', async () => {
    const html = await renderMarkdown(
      [
        '# Title',
        '<script>alert(1)</script>',
        '<img src="x" onerror="alert(1)">',
        '<a href="javascript:alert(1)">bad</a>',
        '**safe**',
      ].join('\n\n'),
    );

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>safe</strong>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror=');
    expect(html).not.toContain('javascript:alert(1)');
  });

  it('strips external-resource and active html from markdown output', async () => {
    const html = await renderMarkdown(
      [
        '<img src="https://attacker.example/pixel.png" alt="pixel">',
        '<audio controls src="https://attacker.example/audio.mp3"></audio>',
        '<form><input value="spoof"></form>',
        '<p style="position:fixed;inset:0">overlay</p>',
        '[safe](https://example.com)',
      ].join('\n\n'),
    );

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<audio');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('style=');
    expect(html).toContain('<a href="https://example.com">safe</a>');
  });

  it('preserves highlighted code block classes for safe markdown output', async () => {
    const html = await renderMarkdown('```javascript\nconst value = 1;\n```');

    expect(html).toContain('<pre><code');
    expect(html).toContain('class="hljs language-javascript"');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-number');
  });

  it('fully escapes fallback code blocks for unknown languages', async () => {
    const html = await renderMarkdown(
      '```unknown\nconst s = "<tag> & \'quote\'";\n```',
    );

    expect(html).toContain('&lt;tag&gt;');
    expect(html).toContain('&amp;');
    expect(html).not.toContain('<tag>');
    expect(html).toContain("'quote'");
  });
});
