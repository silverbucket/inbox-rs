/**
 * Where a card stands with calendars, for the chip and the card view's
 * Calendar section. Pure: callers pass the stores' current values so
 * Svelte re-derives when any of them change.
 */
import type { Collection, InboxItem } from '@inbox-rs/rs-module';
import {
  type CalendarAccount,
  type CalendarChoice,
  entryInCalendar,
} from './calendar-accounts';
import { entryKindFor } from './calendar-sync';

export type CardCalendarMode = 'sync' | 'once' | 'pending';

export interface CardCalendar {
  /** The calendar's href, when known. */
  url?: string;
  name: string;
  color?: string;
  /** The account label, when this device has the account. */
  account?: string;
  mode: CardCalendarMode;
  /** This device has the account, so it syncs from here. */
  connected: boolean;
  /** The card's collection is linked to this calendar. */
  viaCollection: boolean;
  /** Why the last attempt failed, when it did. */
  error?: string;
}

function findChoice(
  accounts: CalendarAccount[],
  match: (calendarUrl: string) => boolean,
): CalendarChoice | undefined {
  for (const account of accounts) {
    const calendar = account.calendars.find((c) => match(c.id));
    if (calendar) return { account, calendar };
  }
  return undefined;
}

export function cardCalendar(
  item: InboxItem,
  allCollections: Record<string, Collection>,
  accounts: CalendarAccount[],
  cardErrors: Record<string, string> = {},
  calendarErrors: Record<string, { error?: string }> = {},
): CardCalendar | null {
  const col = item.collectionId ? allCollections[item.collectionId] : undefined;
  const link = col && !col.archived ? col.calendar : undefined;
  const error = cardErrors[item.id];
  if (item.eventUrl) {
    const href = item.eventUrl;
    const choice = findChoice(accounts, (url) => entryInCalendar(href, url));
    const knownLink =
      link && entryInCalendar(href, link.url)
        ? link
        : Object.values(allCollections)
            .map((c) => c.calendar)
            .find((l) => l && entryInCalendar(href, l.url));
    const url = choice?.calendar.id ?? knownLink?.url;
    const mode: CardCalendarMode = item.calendarSync ? 'sync' : 'once';
    return {
      url,
      name: choice?.calendar.name ?? knownLink?.name ?? 'Calendar',
      color: choice?.calendar.color ?? knownLink?.color,
      account: choice?.account.label,
      mode,
      connected: !!choice,
      viaCollection: !!link && !!url && link.url === url,
      error:
        error ??
        (mode === 'sync' && url ? calendarErrors[url]?.error : undefined),
    };
  }
  if (!link || item.calendarSync === false) return null;
  const choice = findChoice(accounts, (url) => url === link.url);
  // Without the account here, assume the calendar takes both kinds.
  const components = choice?.calendar.components ?? ['event', 'task'];
  if (!entryKindFor(item, components)) return null;
  return {
    url: link.url,
    name: choice?.calendar.name ?? link.name,
    color: choice?.calendar.color ?? link.color,
    account: choice?.account.label,
    mode: 'pending',
    connected: !!choice,
    viaCollection: true,
    error: error ?? calendarErrors[link.url]?.error,
  };
}

/** "Synced 2 min ago" — short, for status lines. */
export function relativeTime(
  iso: string | undefined,
  now = Date.now(),
): string {
  if (!iso) return '';
  const ms = now - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: days > 300 ? 'numeric' : undefined,
  });
}

/** "3 Mar 2024" */
export function shortDate(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(thisYear ? {} : { year: 'numeric' }),
  });
}
