/**
 * Decide what a capture-bar input should become: a bookmark (a single
 * http/https URL or bare dotted host), a note (anything else, including text
 * that merely contains a URL), or empty. Pure — the single source of truth
 * shared by CaptureBar (desktop) and CaptureSheet (mobile).
 */
export type CaptureKind =
  | { kind: 'bookmark'; url: string }
  | { kind: 'note'; body: string }
  | { kind: 'empty' };

export function detectCaptureKind(raw: string): CaptureKind {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };
  const url = asBookmarkUrl(text);
  if (url) return { kind: 'bookmark', url };
  return { kind: 'note', body: raw };
}

function asBookmarkUrl(text: string): string | null {
  if (/\s/.test(text)) return null; // multi-token => note
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    // Has an explicit scheme: only http/https qualify.
    if (!/^https?:\/\//i.test(text)) return null;
    return isHttpUrl(text) ? text : null;
  }
  // No scheme: require a dotted host whose last label looks like a TLD.
  const host = text.split(/[/?#]/, 1)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) return null;
  const lastLabel = host.split('.').pop() ?? '';
  if (!/^[a-z]{2,}$/i.test(lastLabel)) return null;
  const candidate = `https://${text}`;
  return isHttpUrl(candidate) ? candidate : null;
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}
