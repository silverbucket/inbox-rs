import type { BookmarkItem } from '@inbox-rs/rs-module';
import { lacksTitle } from './triage';

export function hasIncompletePreview(item: BookmarkItem): boolean {
  return (
    lacksTitle(item) ||
    (!item.description?.trim() && !item.ogImage && !item.filePath)
  );
}

/** Only the page address and field presence belong in a public report. */
export function metadataReportUrl(item: BookmarkItem): string | null {
  let page: URL;
  try {
    page = new URL(item.url);
  } catch {
    return null;
  }
  if (page.protocol !== 'https:' && page.protocol !== 'http:') return null;
  page.username = '';
  page.password = '';
  page.search = '';
  page.hash = '';
  const issue = new URL('https://github.com/sockethub/sockethub/issues/new');
  issue.searchParams.set(
    'title',
    `Incomplete metadata preview: ${page.hostname}`,
  );
  issue.searchParams.set(
    'body',
    [
      '## Page',
      page.href,
      '',
      'Reported from Inbox RS. Query parameters and fragments are omitted; add any non-sensitive parameters needed to reproduce.',
      '',
      '## Captured preview',
      `- Title: ${lacksTitle(item) ? 'missing or URL/site-name fallback' : 'present'}`,
      `- Description: ${item.description?.trim() ? 'present' : 'missing'}`,
      `- Image: ${item.ogImage || item.filePath ? 'present' : 'missing'}`,
      `- Site name: ${item.siteName ? 'present' : 'missing'}`,
      '',
      '## Expected preview',
      'Describe what should have appeared. Please check that this URL is safe to share publicly before submitting.',
    ].join('\n'),
  );
  return issue.href;
}
