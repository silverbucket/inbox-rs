import type { BookmarkItem } from '@inbox-rs/rs-module';
import { lacksTitle } from './triage';

/** Flag sparse saved metadata, including imported bookmarks without fetch history. */
export function hasIncompletePreview(item: BookmarkItem): boolean {
  return (
    lacksTitle(item) ||
    (!item.description?.trim() && !item.ogImage && !item.filePath)
  );
}

/** Only the page address and field presence belong in a public report. */
export function metadataReportUrl(
  item: BookmarkItem,
  selectedUrl: string,
): string | null {
  let page: URL;
  try {
    page = new URL(selectedUrl);
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

/** Review the entire address locally before sending any part of it to GitHub. */
export function reportPreview(item: BookmarkItem): void {
  let initial = '';
  try {
    const page = new URL(item.url);
    page.username = '';
    page.password = '';
    page.search = '';
    page.hash = '';
    initial = page.href;
  } catch {
    /* The user can supply a valid public address below. */
  }
  const selected = window.prompt(
    'Public Sockethub report: review or replace this page URL before opening GitHub. Remove private hostnames, path tokens, and other secrets. Cancel sends nothing.',
    initial,
  );
  if (!selected) return;
  const draft = metadataReportUrl(item, selected.trim());
  if (draft) window.open(draft, '_blank', 'noopener,noreferrer');
  else window.alert('Enter an http or https URL to report a preview issue.');
}
