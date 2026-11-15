/**
 * Calendar accounts — shared between devices, except the password.
 *
 * An account's server, username, relay and calendar list sync through
 * remoteStorage, so every device (and the staging and release apps alike)
 * shows the same setup. The CalDAV app password does not: storage syncs in
 * plaintext, so each device keeps its own copy in localStorage and asks for
 * it once. Until then the account is "paused" here — listed, but nothing
 * syncs from this device, exactly as if the account lived on another one.
 *
 * `calendarAccounts` holds only the accounts this device can use, so sync
 * and pickers need no password checks. `pausedCalendarAccounts` holds the
 * rest, for the places that offer to enter the password.
 *
 * Accepted trade-off: localStorage is readable by any same-origin script,
 * so an XSS compromise could exfiltrate the stored app passwords. Client-
 * side encryption without a per-session passphrase would only obfuscate
 * (the key would be equally reachable). The UI insists on app-specific
 * passwords instead (scoped, revocable at the provider).
 *
 * The discovered calendar list is cached per account so pickers render
 * instantly; "Refresh" in settings re-runs discovery.
 */
import type { CalendarAccountRecord } from '@inbox-rs/rs-module';
import { derived, get, type Readable, writable } from 'svelte/store';
import type { RemoteCalendar } from './caldav';
import { DEFAULT_SOCKETHUB_ENDPOINT } from './link-metadata';
import type { ScheduleKind } from './schedule';

const STORAGE_KEY = 'inbox-rs:calendar-accounts';
const LAST_USED_KEY = 'inbox-rs:last-calendar';
const PROMPT_DISMISSED_KEY = 'inbox-rs:calendar-password-prompt-dismissed';

const isStagingBuild = typeof __STAGING__ !== 'undefined' && __STAGING__;

export interface CalendarAccount {
  id: string;
  /** Display label, e.g. "Fastmail". Defaults to the server host. */
  label: string;
  url: string;
  username: string;
  /** Device-local, never synced. Empty until entered on this device. */
  password: string;
  /**
   * The sockethub relay endpoint the account's requests go through. Synced
   * with the account, so every device uses the same relay.
   */
  endpoint: string;
  /** Relay for staging builds. Unset falls back to `endpoint`. */
  stagingEndpoint?: string;
  /** Cached discovery result. */
  calendars: RemoteCalendar[];
  /** Deny-list so newly discovered calendars default to visible. */
  hiddenCalendarIds?: string[];
  /** Preferred calendar for this account (settings ★). */
  defaultCalendarId?: string;
  /**
   * Legacy and device-local: calendars whose every task used to sync into
   * unfiled todos. Now only marks calendars that still need linking to a
   * collection (Settings → Calendars offers it); calendar-sync.ts no longer
   * imports from them.
   */
  syncCalendarIds?: string[];
}

/** Fields that stay on this device. */
const LOCAL_FIELDS = new Set(['password', 'syncCalendarIds']);

/** The relay an account's requests go through in this build. */
export function accountEndpoint(
  account: Pick<CalendarAccount, 'endpoint' | 'stagingEndpoint'>,
  staging: boolean = isStagingBuild,
): string {
  return (
    (staging && account.stagingEndpoint) ||
    account.endpoint ||
    DEFAULT_SOCKETHUB_ENDPOINT
  );
}

/**
 * The same server and username always give the same id, so an account added
 * on two devices is one synced record instead of two.
 *
 * Only the scheme and host ignore case (`URL` lowercases them): paths are
 * case-sensitive, so `/dav/Alice` and `/dav/alice` are two accounts. The
 * username does ignore case — CalDAV logins do in practice, and phones
 * capitalise its first letter, which must not split one account into two.
 */
export function calendarAccountId(url: string, username: string): string {
  const key = `${serverKey(url)}\n${username.trim().toLowerCase()}`;
  // cyrb53: a small, well-spread string hash. Not security-relevant.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `cal-${hash.toString(36)}`;
}

function serverKey(url: string): string {
  const trimmed = url.trim();
  let server = trimmed;
  try {
    const parsed = new URL(trimmed);
    server = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    // Not a full URL: hash it as typed.
  }
  return server.replace(/\/+$/, '');
}

/** One entry per account, keyed by server and username. */
function dedupe(accounts: CalendarAccount[]): CalendarAccount[] {
  const byId = new Map<string, CalendarAccount>();
  for (const account of accounts) {
    const id = calendarAccountId(account.url, account.username);
    const seen = byId.get(id);
    // Two copies of one account: keep the one this device can use.
    if (!seen || (!seen.password && account.password)) {
      byId.set(id, { ...account, id });
    }
  }
  return [...byId.values()];
}

function load(): CalendarAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Accounts saved before they synced carry random ids.
    return Array.isArray(parsed) ? dedupe(parsed) : [];
  } catch {
    return [];
  }
}

/** Every account known here, usable or not. */
const everyAccount = writable<CalendarAccount[]>(load());

everyAccount.subscribe((accounts) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  } catch (err) {
    console.error('Failed to persist calendar accounts', err);
  }
});

/** The accounts this device has a password for. */
export const calendarAccounts = {
  subscribe: derived(everyAccount, (accounts) =>
    accounts.filter((a) => !!a.password),
  ).subscribe,
  set: everyAccount.set,
};

/** Accounts set up on another device that still need their password here. */
export const pausedCalendarAccounts: Readable<CalendarAccount[]> = derived(
  everyAccount,
  (accounts) => accounts.filter((a) => !a.password),
);

export const allCalendarAccounts: Readable<CalendarAccount[]> = everyAccount;

export const hasCalendarAccounts = derived(
  calendarAccounts,
  (accounts) => accounts.length > 0,
);

// ---- Sync through remoteStorage ----

export interface CalendarAccountBackend {
  store(record: CalendarAccountRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

let backend: CalendarAccountBackend | null = null;

/** Where account changes are saved for other devices (wired up in stores.ts). */
export function attachCalendarAccountBackend(
  next: CalendarAccountBackend | null,
): void {
  backend = next;
}

function toRecord(account: CalendarAccount): CalendarAccountRecord {
  const { password: _password, syncCalendarIds: _legacy, ...record } = account;
  return record;
}

function push(account: CalendarAccount): void {
  if (!backend) return;
  void backend.store(toRecord(account)).catch((err) => {
    console.error('Failed to sync the calendar account', err);
  });
}

function isRecord(value: unknown): value is CalendarAccountRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<CalendarAccountRecord>;
  return (
    typeof r.id === 'string' &&
    typeof r.url === 'string' &&
    typeof r.username === 'string' &&
    Array.isArray(r.calendars)
  );
}

/** A synced record over the local copy: the device keeps its own fields. */
function merge(
  local: CalendarAccount | undefined,
  record: CalendarAccountRecord,
): CalendarAccount {
  return {
    ...record,
    label: record.label || local?.label || record.url,
    endpoint: record.endpoint ?? '',
    password: local?.password ?? '',
    ...(local?.syncCalendarIds
      ? { syncCalendarIds: local.syncCalendarIds }
      : {}),
  };
}

/**
 * Take the stored accounts as loaded from remoteStorage. Accounts only this
 * device knows (connected before accounts synced, or while offline) are
 * saved for the others. A record missing from the load is never treated as
 * removed: the cache may simply not have synced yet. Removals arrive through
 * `applyCalendarAccountChange`.
 */
export function applyStoredCalendarAccounts(
  records: Record<string, unknown>,
): void {
  const raw = Object.values(records).filter(isRecord);
  // Records saved under an older id formula move to their current id: the
  // current one is stored below (it is missing), then the old one removed.
  const stored = raw.map((r) => ({
    ...r,
    id: calendarAccountId(r.url, r.username),
  }));
  const storedIds = new Set(
    raw.filter((r, i) => r.id === stored[i].id).map((r) => r.id),
  );
  const movedFrom = raw
    .filter((r, i) => r.id !== stored[i].id)
    .map((r) => r.id);
  everyAccount.update((accounts) => {
    const next = accounts.map((a) => {
      const record = stored.find((r) => r.id === a.id);
      return record ? merge(a, record) : a;
    });
    const known = new Set(next.map((a) => a.id));
    for (const record of stored) {
      if (!known.has(record.id)) next.push(merge(undefined, record));
    }
    return next;
  });
  for (const account of get(everyAccount)) {
    if (!storedIds.has(account.id)) push(account);
  }
  for (const id of movedFrom) {
    void backend?.remove(id).catch((err) => {
      console.error('Failed to remove the old calendar account record', err);
    });
  }
}

/** One account changed on another device; `null` means it was removed. */
export function applyCalendarAccountChange(id: string, value: unknown): void {
  everyAccount.update((accounts) => {
    if (!isRecord(value)) return accounts.filter((a) => a.id !== id);
    // A device on an older id formula may still write the old id.
    const record = {
      ...value,
      id: calendarAccountId(value.url, value.username),
    };
    const local = accounts.find((a) => a.id === record.id);
    return local
      ? accounts.map((a) => (a.id === record.id ? merge(a, record) : a))
      : [...accounts, merge(undefined, record)];
  });
}

// ---- Changes made on this device ----

export function addCalendarAccount(
  account: Omit<CalendarAccount, 'id'>,
): CalendarAccount {
  const id = calendarAccountId(account.url, account.username);
  const existing = get(everyAccount).find((a) => a.id === id);
  // Re-adding a known account refreshes it; its calendar choices survive.
  const created: CalendarAccount = { ...existing, ...account, id };
  everyAccount.update((accounts) =>
    existing
      ? accounts.map((a) => (a.id === id ? created : a))
      : [...accounts, created],
  );
  push(created);
  return created;
}

export function updateCalendarAccount(
  id: string,
  patch: Partial<Omit<CalendarAccount, 'id'>>,
): void {
  everyAccount.update((accounts) =>
    accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  );
  if (Object.keys(patch).every((key) => LOCAL_FIELDS.has(key))) return;
  const updated = get(everyAccount).find((a) => a.id === id);
  if (updated) push(updated);
}

/** Save (or with '' forget) the password on this device only. */
export function setCalendarAccountPassword(id: string, password: string): void {
  updateCalendarAccount(id, { password });
}

/** Remove the account from every device. */
export function removeCalendarAccount(id: string): void {
  everyAccount.update((accounts) => accounts.filter((a) => a.id !== id));
  if (!backend) return;
  void backend.remove(id).catch((err) => {
    console.error('Failed to remove the synced calendar account', err);
  });
}

// ---- The one-time "enter your password" prompt ----

function loadDismissed(): string[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(PROMPT_DISMISSED_KEY) ?? '[]',
    );
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const dismissedPrompts = writable<string[]>(loadDismissed());

/** Paused accounts the user hasn't been asked about on this device yet. */
export const accountsAwaitingPassword: Readable<CalendarAccount[]> = derived(
  [pausedCalendarAccounts, dismissedPrompts],
  ([$paused, $dismissed]) => $paused.filter((a) => !$dismissed.includes(a.id)),
);

/** Stop offering the password prompt for these accounts on this device. */
export function dismissPasswordPrompt(ids: string[]): void {
  dismissedPrompts.update((current) => {
    const next = [...new Set([...current, ...ids])];
    try {
      localStorage.setItem(PROMPT_DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // session-only dismissal is fine
    }
    return next;
  });
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
      if (entryInCalendar(eventUrl, calendar.id)) return { account, calendar };
    }
  }
  return undefined;
}

/** Whether `href` (an entry) lives in the calendar collection `calendarUrl`. */
export function entryInCalendar(
  href: string | undefined,
  calendarUrl: string,
): boolean {
  if (!href) return false;
  const prefix = calendarUrl.endsWith('/') ? calendarUrl : `${calendarUrl}/`;
  return href.startsWith(prefix);
}

/** The calendar (on this device) whose id is `calendarUrl`. */
export function choiceForCalendar(
  calendarUrl: string | undefined,
): CalendarChoice | undefined {
  if (!calendarUrl) return undefined;
  for (const account of get(calendarAccounts)) {
    const calendar = account.calendars.find((c) => c.id === calendarUrl);
    if (calendar) return { account, calendar };
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
