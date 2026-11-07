/**
 * A recognisable title for a saved link: the first non-blank candidate (tab
 * title, link text, page title…) that isn't just the URL again, else the
 * URL's host + path ("example.com/articles/foo") rather than the raw URL.
 */
export function recognisableTitle(
  url: string,
  ...candidates: (string | undefined)[]
): string {
  for (const c of candidates) {
    const t = c?.trim();
    if (t && t !== url) return t;
  }
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^www\./, '');
    if (host) return host + pathname.replace(/\/+$/, '');
  } catch {
    // not a parseable URL
  }
  return url;
}
