// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('sanitizes raw html, inline handlers, and javascript urls', async () => {
    const html = await renderMarkdown([
      '# Title',
      '<script>alert(1)</script>',
      '<img src="x" onerror="alert(1)">',
      '<a href="javascript:alert(1)">bad</a>',
      '**safe**',
    ].join('\n\n'));

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>safe</strong>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror=');
    expect(html).not.toContain('javascript:alert(1)');
  });

  it('preserves highlighted code block classes for safe markdown output', async () => {
    const html = await renderMarkdown('```javascript\nconst value = 1;\n```');

    expect(html).toContain('<pre><code');
    expect(html).toContain('class="hljs language-javascript"');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-number');
  });
});
