// @vitest-environment jsdom
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountEndpoint,
  accountsAwaitingPassword,
  addCalendarAccount,
  allCalendarAccounts,
  applyCalendarAccountChange,
  applyStoredCalendarAccounts,
  attachCalendarAccountBackend,
  calendarAccountId,
  calendarAccounts,
  choiceForEventUrl,
  dismissPasswordPrompt,
  findCalendarChoice,
  pausedCalendarAccounts,
  pickPreferredCalendar,
  recordCalendarUse,
  removeCalendarAccount,
  setCalendarAccountPassword,
  updateCalendarAccount,
  visibleCalendarChoices,
} from './calendar-accounts';

const CAL_PERSONAL = {
  id: 'https://cal.example.org/nick/personal/',
  name: 'Personal',
  components: ['event', 'task'] as Array<'event' | 'task'>,
};
const CAL_WORK = {
  id: 'https://cal.example.org/nick/work/',
  name: 'Work',
  components: ['event'] as Array<'event' | 'task'>,
};

function seedAccount(overrides: Record<string, unknown> = {}) {
  return addCalendarAccount({
    label: 'Fastmail',
    url: 'https://cal.example.org/',
    username: 'nick',
    password: 'secret',
    endpoint: 'https://relay.example.org/sockethub-http',
    calendars: [CAL_PERSONAL, CAL_WORK],
    ...overrides,
  });
}

beforeEach(() => {
  localStorage.clear();
  calendarAccounts.set([]);
});

describe('account CRUD + persistence', () => {
  it('persists accounts to localStorage on every change', () => {
    const account = seedAccount();
    const stored = JSON.parse(
      localStorage.getItem('inbox-rs:calendar-accounts') ?? '[]',
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(account.id);

    removeCalendarAccount(account.id);
    expect(
      JSON.parse(localStorage.getItem('inbox-rs:calendar-accounts') ?? '[]'),
    ).toHaveLength(0);
  });

  it('updates patch a single account', () => {
    const account = seedAccount();
    updateCalendarAccount(account.id, { defaultCalendarId: CAL_WORK.id });
    expect(get(calendarAccounts)[0].defaultCalendarId).toBe(CAL_WORK.id);
  });

  it('accountEndpoint returns the pinned relay, with a default fallback', () => {
    const account = seedAccount();
    expect(accountEndpoint(account)).toBe(
      'https://relay.example.org/sockethub-http',
    );
    // Legacy entries without a pin fall back to the app default — never the
    // synced setting.
    expect(accountEndpoint({ ...account, endpoint: '' })).toMatch(
      /sockethub-http$/,
    );
  });
});

describe('visibility and lookup', () => {
  it('hidden calendars leave the picker but still resolve for posted entries', () => {
    const account = seedAccount({ hiddenCalendarIds: [CAL_WORK.id] });
    expect(visibleCalendarChoices().map((c) => c.calendar.name)).toEqual([
      'Personal',
    ]);
    expect(findCalendarChoice(CAL_WORK.id)).toBeUndefined();
    // An entry already posted to the hidden calendar still finds its home.
    const choice = choiceForEventUrl(`${CAL_WORK.id}abc.ics`);
    expect(choice?.calendar.id).toBe(CAL_WORK.id);
    expect(choice?.account.id).toBe(account.id);
  });

  it('choiceForEventUrl matches by href prefix only', () => {
    seedAccount();
    expect(choiceForEventUrl(`${CAL_PERSONAL.id}x.ics`)?.calendar.name).toBe(
      'Personal',
    );
    expect(choiceForEventUrl('https://other.example/x.ics')).toBeUndefined();
    expect(choiceForEventUrl(undefined)).toBeUndefined();
  });
});

describe('pickPreferredCalendar', () => {
  it('prefers last-used, then account default, then first supporting the kind', () => {
    seedAccount({ defaultCalendarId: CAL_WORK.id });
    // No last-used → account default (Work).
    expect(pickPreferredCalendar('event')?.calendar.name).toBe('Work');
    // Work doesn't support tasks → falls to the first task-capable calendar.
    expect(pickPreferredCalendar('task')?.calendar.name).toBe('Personal');
    // Last-used wins once recorded.
    recordCalendarUse('event', CAL_PERSONAL.id);
    expect(pickPreferredCalendar('event')?.calendar.name).toBe('Personal');
  });

  it('returns undefined with no accounts', () => {
    expect(pickPreferredCalendar('event')).toBeUndefined();
  });
});

describe('syncing accounts between devices', () => {
  const RECORD = {
    id: calendarAccountId('https://cal.example.org/', 'nick'),
    label: 'Fastmail',
    url: 'https://cal.example.org/',
    username: 'nick',
    endpoint: 'https://relay.example.org/sockethub-http',
    calendars: [CAL_PERSONAL],
  };

  function fakeBackend() {
    const backend = {
      store: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    };
    attachCalendarAccountBackend(backend);
    return backend;
  }

  afterEach(() => attachCalendarAccountBackend(null));

  it('gives the same account the same id on every device', () => {
    expect(calendarAccountId('https://cal.example.org/', 'nick')).toBe(
      calendarAccountId('https://CAL.example.org', ' Nick '),
    );
    expect(calendarAccountId('https://cal.example.org/', 'nick')).not.toBe(
      calendarAccountId('https://cal.example.org/', 'anna'),
    );
  });

  it('never sends the password to storage', () => {
    const backend = fakeBackend();
    const account = seedAccount({ syncCalendarIds: [CAL_WORK.id] });
    updateCalendarAccount(account.id, { defaultCalendarId: CAL_WORK.id });

    expect(backend.store).toHaveBeenCalledTimes(2);
    for (const [record] of backend.store.mock.calls as unknown[][]) {
      expect(record).not.toHaveProperty('password');
      expect(record).not.toHaveProperty('syncCalendarIds');
      expect(JSON.stringify(record)).not.toContain('secret');
    }
  });

  it('keeps a password change on this device', () => {
    const account = seedAccount();
    const backend = fakeBackend();
    setCalendarAccountPassword(account.id, 'another');
    expect(backend.store).not.toHaveBeenCalled();
    expect(get(calendarAccounts)[0].password).toBe('another');
  });

  it('lists an account from another device as paused until its password is entered', () => {
    fakeBackend();
    applyStoredCalendarAccounts({ [RECORD.id]: RECORD });

    expect(get(calendarAccounts)).toEqual([]);
    expect(get(pausedCalendarAccounts).map((a) => a.label)).toEqual([
      'Fastmail',
    ]);
    // Paused accounts stay out of everything that talks to the calendar.
    expect(visibleCalendarChoices()).toEqual([]);

    setCalendarAccountPassword(RECORD.id, 'secret');
    expect(get(pausedCalendarAccounts)).toEqual([]);
    expect(get(calendarAccounts)[0].calendars).toEqual([CAL_PERSONAL]);
  });

  it('takes synced details but keeps this device’s password', () => {
    const account = seedAccount();
    fakeBackend();
    applyStoredCalendarAccounts({
      [account.id]: { ...RECORD, label: 'Renamed', calendars: [CAL_WORK] },
    });
    const [merged] = get(calendarAccounts);
    expect(merged.label).toBe('Renamed');
    expect(merged.calendars).toEqual([CAL_WORK]);
    expect(merged.password).toBe('secret');
  });

  it('uploads an account only this device knows, and never drops it', () => {
    const account = seedAccount();
    const backend = fakeBackend();
    // Nothing stored yet (or the cache has not synced): not a removal.
    applyStoredCalendarAccounts({});
    expect(get(calendarAccounts)).toHaveLength(1);
    expect(backend.store).toHaveBeenCalledWith(
      expect.objectContaining({ id: account.id, username: 'nick' }),
    );
  });

  it('removes an account everywhere', () => {
    const account = seedAccount();
    const backend = fakeBackend();
    removeCalendarAccount(account.id);
    expect(backend.remove).toHaveBeenCalledWith(account.id);

    // …and a removal on another device removes it here.
    const again = seedAccount();
    applyCalendarAccountChange(again.id, null);
    expect(get(allCalendarAccounts)).toEqual([]);
  });

  it('adding a known account again refreshes it instead of duplicating', () => {
    seedAccount({ hiddenCalendarIds: [CAL_WORK.id] });
    seedAccount({ password: 'new' });
    const accounts = get(calendarAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].password).toBe('new');
    expect(accounts[0].hiddenCalendarIds).toEqual([CAL_WORK.id]);
  });

  it('staging uses its own relay when set and the main one otherwise', () => {
    const account = seedAccount();
    expect(accountEndpoint(account, true)).toBe(account.endpoint);
    const staged = { ...account, stagingEndpoint: 'https://staging.example/x' };
    expect(accountEndpoint(staged, true)).toBe('https://staging.example/x');
    expect(accountEndpoint(staged, false)).toBe(account.endpoint);
  });

  it('asks for a paused account’s password once per device', () => {
    applyStoredCalendarAccounts({ [RECORD.id]: RECORD });
    expect(get(accountsAwaitingPassword)).toHaveLength(1);
    dismissPasswordPrompt([RECORD.id]);
    expect(get(accountsAwaitingPassword)).toEqual([]);
    // Still reachable from settings and the pickers.
    expect(get(pausedCalendarAccounts)).toHaveLength(1);
  });

  it('gives accounts saved before syncing their shared id on load', async () => {
    localStorage.setItem(
      'inbox-rs:calendar-accounts',
      JSON.stringify([
        { ...RECORD, id: 'random-uuid-1', password: '' },
        { ...RECORD, id: 'random-uuid-2', password: 'secret' },
      ]),
    );
    vi.resetModules();
    const fresh = await import('./calendar-accounts');
    const accounts = get(fresh.allCalendarAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe(RECORD.id);
    expect(accounts[0].password).toBe('secret');
  });
});
