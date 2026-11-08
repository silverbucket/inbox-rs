import type { BookmarkItem } from '@inbox-rs/rs-module';
import { describe, expect, it } from 'vitest';
import { hasIncompletePreview, metadataReportUrl } from './metadata-report';

const bookmark: BookmarkItem = {
  id: 'bookmark',
  type: 'bookmark',
  title: 'A useful article',
  url: 'https://example.com/article',
  createdAt: '2026-11-08T00:00:00Z',
};

describe('metadata reports', () => {
  it('offers reporting for fallback titles and sparse previews', () => {
    expect(hasIncompletePreview(bookmark)).toBe(true);
    expect(
      hasIncompletePreview({
        ...bookmark,
        title: 'example.com',
        description: 'Description',
      }),
    ).toBe(true);
    expect(
      hasIncompletePreview({ ...bookmark, description: 'Description' }),
    ).toBe(false);
  });

  it('drafts an upstream issue without credentials, URL tokens, or private notes', () => {
    const result = metadataReportUrl({
      ...bookmark,
      url: 'https://user:password@example.com/article?token=secret#private',
      body: 'Private notes',
    });
    const issue = new URL(result ?? '');
    expect(issue.origin + issue.pathname).toBe(
      'https://github.com/sockethub/sockethub/issues/new',
    );
    expect(issue.searchParams.get('title')).toContain('example.com');
    const body = issue.searchParams.get('body') ?? '';
    expect(body).toContain('https://example.com/article');
    expect(body).toContain('Description: missing');
    for (const privateValue of [
      'user:',
      'password',
      'secret',
      '#private',
      'Private notes',
    ]) {
      expect(body).not.toContain(privateValue);
    }
  });

  it('does not offer an issue link for invalid or non-web URLs', () => {
    expect(metadataReportUrl({ ...bookmark, url: 'invalid' })).toBeNull();
    expect(
      metadataReportUrl({ ...bookmark, url: 'javascript:alert(1)' }),
    ).toBeNull();
  });
});
