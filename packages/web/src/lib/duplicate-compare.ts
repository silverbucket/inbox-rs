import type { Collection, InboxItem } from '@inbox-rs/rs-module';
import { formatScheduled } from './schedule';

/**
 * The cards an inbox card can repeat without being in the inbox itself:
 * filed cards and todos. Archived cards, and cards in an archived
 * collection, are out of sight and never flagged.
 */
export function outsideInbox(
  items: Record<string, InboxItem>,
  collections: Record<string, Collection>,
): InboxItem[] {
  return Object.values(items).filter((item) => {
    if (item.archived) return false;
    if (item.collectionId) return !collections[item.collectionId]?.archived;
    return item.isTodo || item.type === 'todo';
  });
}

/** Where a card lives: its collection, the Todos page, or the Inbox. */
export function whereLabel(
  item: InboxItem,
  collections: Record<string, Collection>,
): string {
  const collection = item.collectionId
    ? collections[item.collectionId]
    : undefined;
  if (collection) return collection.name;
  return item.isTodo || item.type === 'todo' ? 'Todos' : 'Inbox';
}

export interface CompareRow {
  key: string;
  label: string;
  /** One value per copy, in order; '' when the copy has none. */
  values: string[];
  /** The copies disagree, so the row is worth a look. */
  differs: boolean;
}

/** Plain text, cut to a few lines' worth. */
function clip(raw: unknown, max = 160): string {
  if (typeof raw !== 'string') return '';
  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_#>`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function savedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * What to show under each copy in the compare view, one row per fact. Rows
 * no copy has a value for are left out.
 */
export function compareRows(
  copies: InboxItem[],
  collections: Record<string, Collection>,
  now: Date = new Date(),
): CompareRow[] {
  const field = (item: InboxItem, key: string) =>
    (item as unknown as Record<string, unknown>)[key];
  const facts: Array<{
    key: string;
    label: string;
    of: (item: InboxItem) => string;
    /** What to compare when the shown text is cut short or leaves detail out. */
    full?: (item: InboxItem) => string;
    /** Always shown, even when empty. */
    always?: boolean;
    /** Expected to differ: never highlighted. */
    quiet?: boolean;
  }> = [
    {
      key: 'where',
      label: 'In',
      of: (i) => whereLabel(i, collections),
      always: true,
    },
    {
      key: 'saved',
      label: 'Saved',
      of: (i) => savedLabel(i.createdAt),
      always: true,
      quiet: true,
    },
    {
      key: 'title',
      label: 'Title',
      of: (i) => clip(i.title),
      full: (i) => clip(i.title, Infinity),
      always: true,
    },
    {
      key: 'description',
      label: 'Description',
      of: (i) => clip(i.description),
      full: (i) => clip(i.description, Infinity),
    },
    {
      key: 'notes',
      label: 'Notes',
      of: (i) => clip(field(i, 'notes')),
      full: (i) => clip(field(i, 'notes'), Infinity),
    },
    {
      key: 'image',
      label: 'Preview image',
      of: (i) =>
        i.type === 'bookmark' && (field(i, 'ogImage') || field(i, 'filePath'))
          ? 'Yes'
          : '',
    },
    {
      key: 'scheduled',
      label: 'Scheduled',
      of: (i) => formatScheduled(i, now),
      // The label leaves out a timed entry's end.
      full: (i) => [i.startsAt, i.endsAt, i.allDay].join('|'),
    },
    {
      key: 'todo',
      label: 'Todo',
      of: (i) =>
        i.isTodo || i.type === 'todo' ? (i.completed ? 'Done' : 'Open') : '',
    },
    {
      key: 'important',
      label: 'Important',
      of: (i) => (i.pinned ? 'Yes' : ''),
    },
    {
      key: 'calendar',
      label: 'Calendar',
      of: (i) =>
        !i.eventUrl ? '' : i.calendarSync === true ? 'In sync' : 'Sent once',
    },
  ];
  const rows: CompareRow[] = [];
  for (const fact of facts) {
    const values = copies.map(fact.of);
    if (!fact.always && values.every((v) => !v)) continue;
    const compared = copies.map(fact.full ?? fact.of);
    rows.push({
      key: fact.key,
      label: fact.label,
      values,
      differs: !fact.quiet && compared.some((v) => v !== compared[0]),
    });
  }
  return rows;
}
