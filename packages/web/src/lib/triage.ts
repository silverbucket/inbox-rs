import type { Collection, InboxItem } from '@inbox-rs/rs-module';
import type { PlanChoice } from './plan';

/**
 * Inbox triage: pure helpers behind the Inbox's age groups, the card hints
 * (duplicate, missing title, a suggested collection or date) and the
 * one-card-at-a-time "Process inbox" panel.
 *
 * Everything here is explainable in a few words on screen, so each rule is a
 * plain heuristic — no fuzzy scoring.
 */

const DAY_MS = 86_400_000;
/** Cards older than this are "sitting": still useful, or archive them? */
export const STALE_DAYS = 60;

function startOfDay(d: Date): Date {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  return t;
}

export type AgeBucket = 'new' | 'earlier' | 'stale';

/** Which age group a card sits in, by when it was captured. */
export function ageBucket(
  item: Pick<InboxItem, 'createdAt'>,
  now: Date,
): AgeBucket {
  const created = new Date(item.createdAt).getTime();
  if (Number.isNaN(created)) return 'earlier';
  const yesterday = startOfDay(now).getTime() - DAY_MS;
  if (created >= yesterday) return 'new';
  if (created < now.getTime() - STALE_DAYS * DAY_MS) return 'stale';
  return 'earlier';
}

export interface InboxGroup {
  key: AgeBucket;
  label: string;
  /** Muted text beside the heading. */
  hint: string;
  items: InboxItem[];
}

function shortDate(d: Date, now: Date): string {
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * Split the inbox (already in display order) into its age groups, keeping
 * that order inside each group. Empty groups are left out.
 */
export function groupInbox(items: InboxItem[], now: Date): InboxGroup[] {
  const by: Record<AgeBucket, InboxItem[]> = {
    new: [],
    earlier: [],
    stale: [],
  };
  for (const item of items) by[ageBucket(item, now)].push(item);
  const groups: InboxGroup[] = [];
  if (by.new.length) {
    groups.push({
      key: 'new',
      label: 'New since yesterday',
      hint: String(by.new.length),
      items: by.new,
    });
  }
  if (by.earlier.length) {
    const times = by.earlier
      .map((i) => new Date(i.createdAt).getTime())
      .filter((t) => !Number.isNaN(t));
    const range =
      times.length > 0
        ? (() => {
            const from = shortDate(new Date(Math.min(...times)), now);
            const to = shortDate(new Date(Math.max(...times)), now);
            return from === to ? `${from} · ` : `${from} – ${to} · `;
          })()
        : '';
    groups.push({
      key: 'earlier',
      label: 'Earlier',
      hint: `${range}${by.earlier.length}`,
      items: by.earlier,
    });
  }
  if (by.stale.length) {
    groups.push({
      key: 'stale',
      label: 'Sitting for over two months',
      hint: 'still useful? archive or file it',
      items: by.stale,
    });
  }
  return groups;
}

/** "today", "yesterday", "5 days ago", then a short date. */
export function relativeAge(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round(
    (startOfDay(now).getTime() - startOfDay(d).getTime()) / DAY_MS,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return shortDate(d, now);
}

/** What the Inbox tells a card to show beyond its content. */
export interface CardHints {
  /** A short warning line ("Same as …", "No title came through"). */
  flag?: string;
  /** A collection worth offering as a one-click "File to …?". */
  suggest?: Collection | null;
  /** Repeats another card. */
  duplicate?: boolean;
  /** Sitting for over two months. */
  stale?: boolean;
  /** The card the Process inbox panel is showing. */
  active?: boolean;
}

// ── Duplicates ──────────────────────────────────────────────────────────

function bodyOf(item: InboxItem): string {
  const r = item as unknown as Record<string, unknown>;
  return (
    (typeof r.body === 'string' && r.body) ||
    (typeof r.notes === 'string' && r.notes) ||
    item.description ||
    ''
  );
}

function textOf(item: InboxItem): string {
  return `${item.title ?? ''} ${bodyOf(item)}`;
}

function urlKey(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, '');
    return `url:${u.hostname.replace(/^www\./, '')}${path}${u.search}`;
  } catch {
    return null;
  }
}

/** Lowercased words only, so "**Minnesota…" and "Minnesota…" match. */
function textKey(item: InboxItem): string | null {
  // Titles are often cut from the body at different lengths, so the body is
  // the better fingerprint; a title stands in only when there's no body.
  const words = (bodyOf(item) || item.title || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    // Decimal digits only: footnote marks (¹) are noise.
    .replace(/[^\p{L}\p{Nd}]+/gu, ' ')
    .trim();
  // Short texts ("todo", "idea") collide by accident; only flag real content.
  if (words.length < 24) return null;
  return `text:${words.slice(0, 120)}`;
}

function dupKey(item: InboxItem): string | null {
  if (item.type === 'bookmark') {
    return urlKey((item as unknown as { url?: unknown }).url);
  }
  if (item.type === 'note' || item.type === 'email') return textKey(item);
  return null;
}

/**
 * For each card that repeats another (same link, or the same words), the
 * card it repeats. Each card points at the first other copy in `items`.
 */
export function findDuplicates(items: InboxItem[]): Map<string, InboxItem> {
  const groups = new Map<string, InboxItem[]>();
  for (const item of items) {
    const key = dupKey(item);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const out = new Map<string, InboxItem>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (const item of list) {
      const other = list.find((o) => o.id !== item.id);
      if (other) out.set(item.id, other);
    }
  }
  return out;
}

// ── Missing title ───────────────────────────────────────────────────────

/** A bookmark whose title is empty, its URL, or just the site's name. */
export function lacksTitle(item: InboxItem): boolean {
  if (item.type !== 'bookmark') return false;
  const url = (item as unknown as { url?: string }).url ?? '';
  const title = (item.title ?? '').trim().toLowerCase();
  if (!title || title === url.toLowerCase()) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return title === host || title === host.split('.')[0];
  } catch {
    return false;
  }
}

// ── Suggested date ──────────────────────────────────────────────────────

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const MONTH =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
const YEAR = '(?:,?\\s+(\\d{4}))?';
const MONTH_FIRST = new RegExp(`\\b${MONTH}\\.?\\s+${DAY}\\b${YEAR}`, 'gi');
const DAY_FIRST = new RegExp(
  `\\b${DAY}\\s+(?:of\\s+)?${MONTH}\\.?\\b${YEAR}`,
  'gi',
);
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

function makeDate(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m, d);
  return date.getFullYear() === y &&
    date.getMonth() === m &&
    date.getDate() === d
    ? date
    : null;
}

/** A date with no year means its next occurrence (today included). */
function resolve(
  m: number,
  d: number,
  y: number | null,
  today: Date,
): Date | null {
  if (y !== null) return makeDate(y, m, d);
  const thisYear = makeDate(today.getFullYear(), m, d);
  if (thisYear && thisYear >= today) return thisYear;
  return makeDate(today.getFullYear() + 1, m, d);
}

/**
 * The first upcoming date written in a card's title or text ("Nov 26",
 * "26 November 2026", "2026-11-26"), if any. Past dates and dates more than
 * two years out are ignored: they are references, not plans.
 */
export function suggestedDate(item: InboxItem, now: Date): Date | null {
  const text = textOf(item).replace(/<[^>]+>/g, ' ');
  const today = startOfDay(now);
  const limit = new Date(today);
  limit.setFullYear(limit.getFullYear() + 2);
  const found: Array<{ at: number; date: Date }> = [];
  const keep = (at: number, date: Date | null) => {
    if (date && date >= today && date <= limit) found.push({ at, date });
  };
  for (const m of text.matchAll(MONTH_FIRST)) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    keep(
      m.index ?? 0,
      resolve(month, Number(m[2]), m[3] ? Number(m[3]) : null, today),
    );
  }
  for (const m of text.matchAll(DAY_FIRST)) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    keep(
      m.index ?? 0,
      resolve(month, Number(m[1]), m[3] ? Number(m[3]) : null, today),
    );
  }
  for (const m of text.matchAll(ISO)) {
    keep(m.index ?? 0, makeDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  found.sort((a, b) => a.at - b.at);
  return found[0]?.date ?? null;
}

// ── Quick filing suggestion ─────────────────────────────────────────────

function domainOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Site → the collection that already holds a bookmark from it. Built once
 * per render so per-card lookups stay cheap on a large inbox.
 */
export function buildSiteIndex(
  collections: Collection[],
  allItems: Record<string, InboxItem>,
): Map<string, Collection> {
  const index = new Map<string, Collection>();
  for (const col of collections) {
    for (const id of col.itemIds) {
      const domain = domainOf(
        (allItems[id] as { url?: unknown } | undefined)?.url,
      );
      if (domain && !index.has(domain)) index.set(domain, col);
    }
  }
  return index;
}

function nameIn(name: string, text: string): boolean {
  const needle = name.trim().toLowerCase();
  if (needle.length < 3) return false;
  const hay = text.toLowerCase();
  const at = hay.indexOf(needle);
  if (at === -1) return false;
  const edge = (ch: string | undefined) =>
    ch === undefined || !/[\p{L}\p{N}]/u.test(ch);
  return edge(hay[at - 1]) && edge(hay[at + needle.length]);
}

/**
 * The one collection worth naming on a card: where this site is already
 * filed, else a collection whose name appears in the card's title. Recent
 * use alone isn't enough to suggest on every card.
 */
export function quickSuggestion(
  item: InboxItem,
  siteIndex: Map<string, Collection>,
  collections: Collection[],
): Collection | null {
  const domain = domainOf((item as { url?: unknown }).url);
  const bySite = domain ? siteIndex.get(domain) : undefined;
  if (bySite) return bySite;
  const title = item.title ?? '';
  return collections.find((c) => nameIn(c.name, title)) ?? null;
}

// ── Process inbox ───────────────────────────────────────────────────────

/** "Make it a todo for…" choices, with their keyboard shortcuts. */
export type TriageHorizon =
  | 'today'
  | Exclude<PlanChoice, 'nextWeek' | 'nextMonth'>;

export const TRIAGE_HORIZONS: Array<{
  key: TriageHorizon;
  label: string;
  shortcut: string;
}> = [
  { key: 'today', label: 'Today', shortcut: 't' },
  { key: 'next', label: 'Up next', shortcut: 'n' },
  { key: 'week', label: 'This week', shortcut: 'w' },
  { key: 'month', label: 'This month', shortcut: 'm' },
  { key: 'someday', label: 'Someday', shortcut: 's' },
];

/**
 * The card the panel shows: the first queued id at or after `pos` that is
 * still in the inbox. Cards handled elsewhere simply drop out.
 */
export function nextInQueue(
  queue: string[],
  pos: number,
  inInbox: (id: string) => boolean,
): number {
  for (let i = Math.max(0, pos); i < queue.length; i++) {
    if (inInbox(queue[i])) return i;
  }
  return -1;
}

/** Same as nextInQueue, looking back from `pos`. */
export function previousInQueue(
  queue: string[],
  pos: number,
  inInbox: (id: string) => boolean,
): number {
  for (let i = Math.min(pos, queue.length) - 1; i >= 0; i--) {
    if (inInbox(queue[i])) return i;
  }
  return -1;
}
