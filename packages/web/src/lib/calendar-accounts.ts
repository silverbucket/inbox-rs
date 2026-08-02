/**
 * Calendar accounts — device-local by design.
 *
 * Credentials (CalDAV app passwords) live in localStorage on this device
 * only. They are deliberately NOT synced through remoteStorage: user data
 * there syncs in plaintext, and per-request relay through sockethub means
 * no server ever stores them. Each device that wants to post to a calendar
 * connects its own account.
 *
 * Accepted trade-off: localStorage is readable by any same-origin script,
 * so an XSS compromise could exfiltrate the stored app passwords. Client-
 * side encryption without a per-session passphrase would only obfuscate
 * (the key would be equally reachable). Mitigations instead: the UI
 * insists on app-specific passwords (scoped, revocable at the provider),
 * and the relay endpoint is pinned per account at connect time so synced
 * settings can never redirect credential traffic (see `endpoint`).
 *
 * The discovered calendar list is cached per account so pickers render
 * instantly; "Refresh" in settings re-runs discovery.
 */
import { derived, get, writable } from 'svelte/store';
import type { RemoteCalendar } from './caldav';
import { DEFAULT_SOCKETHUB_ENDPOINT } from './link-metadata';
import type { ScheduleKind } from './schedule';

const STORAGE_KEY = 'inbox-rs:calendar-accounts';
const LAST_USED_KEY = 'inbox-rs:last-calendar';

export interface CalendarAccount {
  id: string;
  /** Display label, e.g. "Fastmail". Defaults to the server host. */
  label: string;
  url: string;
  username: string;
  password: string;
  /**
   * The sockethub relay endpoint, pinned at connect time. Credential-bearing
   * requests must NOT resolve the relay from the synced `sockethubUrl`
   * setting at call time: settings sync through remoteStorage, so a
   * compromised linked device could silently redirect this device's
   * credential traffic. Pinning here (device-local, set only by the explicit
   * local connect action) closes that path — changing relays means
   * re-adding the account.
   */
  endpoint: string;
  /** Cached discovery result. */
  calendars: RemoteCalendar[];
  /** Deny-list so newly discovered calendars default to visible. */
  hiddenCalendarIds?: string[];
  /** Preferred calendar for this account (settings ★). */
  defaultCalendarId?: string;
}

/** The pinned relay for an account (default fallback for legacy entries). */
export function accountEndpoint(account: CalendarAccount): string {
  return account.endpoint || DEFAULT_SOCKETHUB_ENDPOINT;
}

function load(): CalendarAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const calendarAccounts = writable<CalendarAccount[]>(load());

calendarAccounts.subscribe((accounts) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  } catch (err) {
    console.error('Failed to persist calendar accounts', err);
  }
});

export const hasCalendarAccounts = derived(
  calendarAccounts,
  (accounts) => accounts.length > 0,
);

export function addCalendarAccount(
  account: Omit<CalendarAccount, 'id'>,
): CalendarAccount {
  const created: CalendarAccount = { ...account, id: crypto.randomUUID() };
  calendarAccounts.update((accounts) => [...accounts, created]);
  return created;
}

export function updateCalendarAccount(
  id: string,
  patch: Partial<Omit<CalendarAccount, 'id'>>,
): void {
  calendarAccounts.update((accounts) =>
    accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  );
}

export function removeCalendarAccount(id: string): void {
  calendarAccounts.update((accounts) => accounts.filter((a) => a.id !== id));
}

export interface CalendarChoice {
  account: CalendarAccount;
  calendar: RemoteCalendar;
}

/** Every non-hidden calendar across accounts, in account order. */
export function visibleCalendarChoices(
  accounts: CalendarAccount[] = get(calendarAccounts),
): CalendarChoice[] {
  return accounts.flatMap((account) =>
    account.calendars
      .filter((c) => !account.hiddenCalendarIds?.includes(c.id))
      .map((calendar) => ({ account, calendar })),
  );
}

export function findCalendarChoice(
  calendarId: string | undefined,
): CalendarChoice | undefined {
  if (!calendarId) return undefined;
  return visibleCalendarChoices().find((c) => c.calendar.id === calendarId);
}

/**
 * The calendar an already-posted entry lives in: its href sits under the
 * calendar collection's href. Hidden calendars still match — hiding affects
 * the picker, not the ability to update/remove what was already posted.
 */
export function choiceForEventUrl(
  eventUrl: string | undefined,
): CalendarChoice | undefined {
  if (!eventUrl) return undefined;
  for (const account of get(calendarAccounts)) {
    for (const calendar of account.calendars) {
      const prefix = calendar.id.endsWith('/')
        ? calendar.id
        : `${calendar.id}/`;
      if (eventUrl.startsWith(prefix)) return { account, calendar };
    }
  }
  return undefined;
}

/** Remember the chosen calendar per entry kind ("events" vs "tasks"). */
export function recordCalendarUse(
  kind: ScheduleKind,
  calendarId: string,
): void {
  try {
    localStorage.setItem(`${LAST_USED_KEY}:${kind}`, calendarId);
  } catch {
    // best-effort — the picker just falls back to the default
  }
}

/**
 * The picker's initial selection: last used for this kind → an account's
 * default → the first visible calendar supporting the kind → first visible.
 */
export function pickPreferredCalendar(
  kind: ScheduleKind,
): CalendarChoice | undefined {
  const choices = visibleCalendarChoices();
  if (choices.length === 0) return undefined;
  let lastUsed: string | null = null;
  try {
    lastUsed = localStorage.getItem(`${LAST_USED_KEY}:${kind}`);
  } catch {
    // fall through to defaults
  }
  const supports = (c: CalendarChoice) => c.calendar.components.includes(kind);
  return (
    choices.find((c) => c.calendar.id === lastUsed && supports(c)) ??
    choices.find(
      (c) => c.calendar.id === c.account.defaultCalendarId && supports(c),
    ) ??
    choices.find(supports) ??
    choices[0]
  );
}
