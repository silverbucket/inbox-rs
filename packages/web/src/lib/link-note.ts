import type { InboxItem } from '@inbox-rs/rs-module';

const NOTE_PREVIEW_MAX = 160;

/** One line of markdown as the plain text a card can show. */
function plainLine(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)*/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/\*(\S(?:[^*]*\S)?)\*/g, '$1')
    .trim();
}

/**
 * The first line of the note a person wrote on a link, as plain text.
 *
 * A link's `description` is the page's own summary; its `body` is what the
 * person added, and says why they kept it. Cards show this line so the note
 * is readable without opening the card. Code fences and rules are skipped.
 */
export function linkNote(item: InboxItem): string | null {
  if (item.type !== 'bookmark' || typeof item.body !== 'string') return null;
  for (const raw of item.body.split(/\r\n?|\n/)) {
    if (/^\s*(?:```|~~~|(?:[-*_]\s*){3,}$)/.test(raw)) continue;
    const line = plainLine(raw);
    if (line) {
      return line.length > NOTE_PREVIEW_MAX
        ? `${line.slice(0, NOTE_PREVIEW_MAX)}…`
        : line;
    }
  }
  return null;
}
