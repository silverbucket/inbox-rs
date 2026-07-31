// @vitest-environment jsdom
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCalendarAccount,
  calendarAccounts,
  choiceForEventUrl,
  findCalendarChoice,
  pickPreferredCalendar,
  recordCalendarUse,
  removeCalendarAccount,
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
