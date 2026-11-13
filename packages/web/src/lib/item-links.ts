import type { InboxItem } from '@inbox-rs/rs-module';

/**
 * Links from one item's markdown to another item.
 *
 * A link is stored as an ordinary markdown link whose destination is the
 * target's in-app address: `[Title](#/item/<id>)`. Only the id matters —
 * wherever the link is shown, the text is replaced with the target's
 * current title, so renaming an item updates every list that points at it.
 * The stored text is the fallback for places that don't know the item
 * (another app reading the same storage, or a target that was deleted).
 */

const ITEM_HREF = /^#\/item\/([^/?#]+)$/;

/** The in-app address of an item. */
export function itemHref(id: string): string {
  // Parentheses are legal in a URL but end a markdown link destination.
  const safe = encodeURIComponent(id).replace(
    /[()]/g,
    (c) => `%${c.charCodeAt(0).toString(16)}`,
  );
  return `#/item/${safe}`;
}

/** The item id an href points at, or null when it isn't an item link. */
export function itemIdFromHref(href: string | null | undefined): string | null {
  const match = href ? ITEM_HREF.exec(href) : null;
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]) || null;
  } catch {
    // Malformed percent-encoding: not a link we can follow.
    return null;
  }
}

/** What to call an item in a link or a picker row. */
export function itemLinkTitle(item: Pick<InboxItem, 'title'>): string {
  return item.title?.trim() || 'Untitled';
}

/** Markdown for a link to an item. */
export function itemLinkMarkdown(title: string, id: string): string {
  const text = title
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\[\]]/g, '\\$&');
  return `[${text || 'Untitled'}](${itemHref(id)})`;
}

/**
 * The item-link query being typed at the end of `textBefore` (the text
 * between the start of the block and the cursor), or null when the cursor
 * isn't inside one. `[[` opens it; the query runs up to the cursor.
 * `length` is how many characters, `[[` included, the query occupies.
 */
export function matchItemLinkTrigger(
  textBefore: string,
): { query: string; length: number } | null {
  const match = /\[\[([^[\]\n￼]{0,60})$/.exec(textBefore);
  if (!match) return null;
  return { query: match[1], length: match[0].length };
}
