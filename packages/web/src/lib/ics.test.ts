import type { InboxItem, NoteItem, TodoItem } from '@inbox-rs/rs-module';
import { describe, expect, it } from 'vitest';
import {
  buildIcs,
  escapeText,
  foldLine,
  isCalendarFile,
  parseIcs,
  parseIcsDate,
  unescapeText,
} from './ics';

const NOW = new Date('2026-07-30T12:00:00Z');

function note(overrides: Partial<NoteItem> = {}): InboxItem {
  return {
    id: 'abc-123',
    type: 'note',
    title: 'Test note',
    body: '',
    createdAt: '2026-07-28T09:00:00Z',
    startsAt: '2026-07-31T09:00:00+02:00',
    ...overrides,
  } as NoteItem;
}

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });
});

describe('foldLine', () => {
  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds long lines at 75 octets with a leading space', () => {
    const folded = foldLine(`DESCRIPTION:${'x'.repeat(200)}`);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const [i, line] of lines.entries()) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      if (i > 0) expect(line.startsWith(' ')).toBe(true);
    }
    // Unfolding restores the original content.
    expect(folded.replace(/\r\n /g, '')).toBe(`DESCRIPTION:${'x'.repeat(200)}`);
  });

  it('never splits a multi-byte character across a fold', () => {
    const folded = foldLine(`SUMMARY:${'é'.repeat(100)}`);
    for (const line of folded.split('\r\n')) {
      // Round-tripping through encode/decode is lossless only when no
      // character was split.
      const bytes = new TextEncoder().encode(line);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(
        line,
      );
    }
  });
});

describe('buildIcs', () => {
  it('returns null for unscheduled items', () => {
    expect(buildIcs(note({ startsAt: undefined }), NOW)).toBeNull();
  });

  it('builds a timed VEVENT in UTC', () => {
    const ics = buildIcs(note({ endsAt: '2026-07-31T10:00:00+02:00' }), NOW)!;
    expect(ics.text).toContain('BEGIN:VEVENT');
    expect(ics.text).toContain('DTSTART:20260731T070000Z');
    expect(ics.text).toContain('DTEND:20260731T080000Z');
    expect(ics.text).toContain('UID:abc-123@inbox-rs');
    expect(ics.text).toContain('SUMMARY:Test note');
    expect(ics.text).toContain('DTSTAMP:20260730T120000Z');
    expect(ics.text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('builds all-day events with an exclusive DTEND', () => {
    // Local-time fixture: all-day dates are taken in the runner's local
    // day, so a fixed-offset instant would flip dates on far-west runners.
    const localMidnight = new Date(2026, 6, 31);
    const ics = buildIcs(
      note({
        startsAt: localMidnight.toISOString(),
        allDay: true,
        endsAt: undefined,
      }),
      NOW,
    )!;
    expect(ics.text).toContain('DTSTART;VALUE=DATE:20260731');
    expect(ics.text).toContain('DTEND;VALUE=DATE:20260801');
  });

  it('builds a VTODO with DUE for tasks, STATUS when completed', () => {
    const todo: TodoItem = {
      id: 'todo-1',
      type: 'todo',
      title: 'Call dentist',
      completed: true,
      createdAt: '2026-07-28T09:00:00Z',
      startsAt: '2026-07-31T14:00:00Z',
      scheduleKind: 'task',
    };
    const ics = buildIcs(todo, NOW)!;
    expect(ics.text).toContain('BEGIN:VTODO');
    expect(ics.text).toContain('DUE:20260731T140000Z');
    expect(ics.text).toContain('STATUS:COMPLETED');
    expect(ics.text).not.toContain('VEVENT');
  });

  it('writes LOCATION, escaped', () => {
    const ics = buildIcs(note({ location: 'HQ, 3rd floor' }), NOW);
    expect(ics?.text).toContain('LOCATION:HQ\\, 3rd floor');
  });

  it('includes DESCRIPTION and bookmark URL, escaped', () => {
    const ics = buildIcs(
      {
        id: 'bm-1',
        type: 'bookmark',
        title: 'Docs; part 1',
        url: 'https://example.org/a,b',
        description: 'line1\nline2',
        createdAt: '2026-07-28T09:00:00Z',
        startsAt: '2026-07-31T09:00:00Z',
      },
      NOW,
    )!;
    expect(ics.text).toContain('SUMMARY:Docs\\; part 1');
    expect(ics.text).toContain('DESCRIPTION:line1\\nline2');
    // URL is a URI value type — emitted verbatim, no TEXT escaping.
    expect(ics.text).toContain('URL:https://example.org/a,b');
  });

  it('writes the URL a calendar import left as a note body', () => {
    const ics = buildIcs({
      id: 'n1',
      type: 'note',
      title: 'Talk',
      body: 'https://www.meetup.com/x/',
      createdAt: '2026-01-01T00:00:00.000Z',
      startsAt: '2026-07-31T07:00:00.000Z',
      scheduleKind: 'event',
    });
    expect(ics?.text).toContain('URL:https://www.meetup.com/x/');
    const prose = buildIcs({
      id: 'n2',
      type: 'note',
      title: 'Talk',
      body: 'see https://www.meetup.com/x/ later',
      createdAt: '2026-01-01T00:00:00.000Z',
      startsAt: '2026-07-31T07:00:00.000Z',
      scheduleKind: 'event',
    });
    expect(prose?.text).not.toContain('URL:');
  });

  it('drops a URL carrying control characters instead of injecting lines', () => {
    const ics = buildIcs(
      {
        id: 'bm-2',
        type: 'bookmark',
        title: 'x',
        url: 'https://example.org/\r\nX-INJECTED:1',
        createdAt: '2026-07-28T09:00:00Z',
        startsAt: '2026-07-31T09:00:00Z',
      },
      NOW,
    )!;
    expect(ics.text).not.toContain('URL:');
    expect(ics.text).not.toContain('X-INJECTED');
  });

  it('derives a safe filename from the title', () => {
    const ics = buildIcs(note({ title: 'Héllo / World!!' }), NOW)!;
    expect(ics.filename).toBe('h-llo-world.ics');
  });
});

// Trimmed from Meetup's real export: TZID form with an embedded VTIMEZONE,
// folded + escaped DESCRIPTION, parameterised URL, no LOCATION at all.
const MEETUP_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Meetup//Meetup Calendar 1.0//EN',
  'METHOD:PUBLISH',
  'BEGIN:VTIMEZONE',
  'TZID:America/Chicago',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700308T020000',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:event_316315179@meetup.com',
  'DTSTART;TZID=America/Chicago:20261109T180000',
  'DTEND;TZID=America/Chicago:20261109T200000',
  'SUMMARY:ACM/IEEE Austin Tech Talks & Community Showcase',
  'DESCRIPTION:Join [ACM Austin + I',
  ' EEE](https://local.acm.org/) for our meetup\\, an evening of talks.\\nSe',
  ' e you there.',
  'URL;VALUE=URI:https://www.meetup.com/acm-austin/events/316315179/',
  'STATUS:CONFIRMED',
  'BEGIN:VALARM',
  'DESCRIPTION:Reminder',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('parseIcsDate', () => {
  it('reads UTC, zoned, floating and date-only forms', () => {
    expect(parseIcsDate('20261109T180000Z')?.date.toISOString()).toBe(
      '2026-11-09T18:00:00.000Z',
    );
    expect(
      parseIcsDate('20261109T180000', {
        TZID: 'America/Chicago',
      })?.date.toISOString(),
    ).toBe('2026-11-10T00:00:00.000Z');
    // DST: the same wall-clock time in July is CDT, one hour earlier in UTC.
    expect(
      parseIcsDate('20260709T180000', {
        TZID: 'America/Chicago',
      })?.date.toISOString(),
    ).toBe('2026-07-09T23:00:00.000Z');
    expect(parseIcsDate('20261109T180000')).toEqual({
      date: new Date(2026, 10, 9, 18, 0, 0),
      allDay: false,
    });
    expect(parseIcsDate('20261109', { VALUE: 'DATE' })).toEqual({
      date: new Date(2026, 10, 9),
      allDay: true,
    });
    expect(parseIcsDate('next tuesday')).toBeNull();
  });

  it('rejects dates and times that do not exist instead of rolling over', () => {
    expect(parseIcsDate('20260230', { VALUE: 'DATE' })).toBeNull();
    expect(parseIcsDate('20261109T250000Z')).toBeNull();
    expect(parseIcsDate('20261301T100000')).toBeNull();
  });

  it('keeps a spring-forward gap time on the pre-transition offset', () => {
    // 02:30 does not exist in Chicago on 2026-03-08; it reads as 03:30 CDT.
    expect(
      parseIcsDate('20260308T023000', {
        TZID: 'America/Chicago',
      })?.date.toISOString(),
    ).toBe('2026-03-08T08:30:00.000Z');
    // Same gap in a positive-offset zone: 02:30 Berlin reads as 03:30 CEST.
    expect(
      parseIcsDate('20260329T023000', {
        TZID: 'Europe/Berlin',
      })?.date.toISOString(),
    ).toBe('2026-03-29T01:30:00.000Z');
  });

  it('resolves an ambiguous fall-back time to its first occurrence', () => {
    expect(
      parseIcsDate('20261025T023000', {
        TZID: 'Europe/Berlin',
      })?.date.toISOString(),
    ).toBe('2026-10-25T00:30:00.000Z');
    expect(
      parseIcsDate('20261101T013000', {
        TZID: 'America/Chicago',
      })?.date.toISOString(),
    ).toBe('2026-11-01T06:30:00.000Z');
  });

  it('maps a Windows zone name without VTIMEZONE to IANA', () => {
    expect(
      parseIcsDate('20261109T180000', {
        TZID: 'W. Europe Standard Time',
      })?.date.toISOString(),
    ).toBe('2026-11-09T17:00:00.000Z');
  });

  it('falls back to floating local time for an unknown TZID, flagged', () => {
    expect(
      parseIcsDate('20261109T180000', { TZID: 'Narnia Standard Time' }),
    ).toEqual({
      date: new Date(2026, 10, 9, 18, 0, 0),
      allDay: false,
      unresolvedZone: 'Narnia Standard Time',
    });
  });
});

// Trimmed Outlook invite: Windows zone name, quoted, with its VTIMEZONE.
const outlookIcs = (start: string, end: string) =>
  [
    'BEGIN:VCALENDAR',
    'PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN',
    'BEGIN:VTIMEZONE',
    'TZID:Eastern Standard Time',
    'BEGIN:STANDARD',
    'DTSTART:16011104T020000',
    'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:16010311T020000',
    'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'SUMMARY:Quarterly review',
    `DTSTART;TZID="Eastern Standard Time":${start}`,
    `DTEND;TZID="Eastern Standard Time":${end}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

describe('parseIcs', () => {
  it('places an Outlook Windows-zone invite in Eastern time across DST', () => {
    const winter = parseIcs(outlookIcs('20261109T180000', '20261109T190000'));
    expect(winter?.start.toISOString()).toBe('2026-11-09T23:00:00.000Z');
    expect(winter?.end?.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(winter?.unresolvedZone).toBeUndefined();
    const summer = parseIcs(outlookIcs('20260709T180000', '20260709T190000'));
    expect(summer?.start.toISOString()).toBe('2026-07-09T22:00:00.000Z');
  });

  it('flags an unknown zone that appears only on DTEND', () => {
    const ics = outlookIcs('20261109T180000', '20261109T190000').replace(
      'DTEND;TZID="Eastern Standard Time"',
      'DTEND;TZID="Narnia Standard Time"',
    );
    expect(parseIcs(ics)?.unresolvedZone).toBe('Narnia Standard Time');
  });

  it('reads a real-world zoned VEVENT, skipping VTIMEZONE and VALARM', () => {
    const parsed = parseIcs(MEETUP_ICS);
    expect(parsed).toMatchObject({
      title: 'ACM/IEEE Austin Tech Talks & Community Showcase',
      kind: 'event',
      allDay: false,
    });
    expect(parsed?.start.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(parsed?.end?.toISOString()).toBe('2026-11-10T02:00:00.000Z');
    expect(parsed?.body).toBe(
      'https://www.meetup.com/acm-austin/events/316315179/',
    );
    expect(parsed?.description).toBe(
      'Join [ACM Austin + IEEE](https://local.acm.org/) for our meetup, an evening of talks.\nSee you there.',
    );
  });

  it('decodes an escaped backslash without re-reading it as an escape', () => {
    expect(unescapeText('C:\\\\temp\\\\n is a path\\, not a newline')).toBe(
      'C:\\temp\\n is a path, not a newline',
    );
  });

  it('reads an all-day event with a location and a cancelled status', () => {
    const parsed = parseIcs(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261225',
        'DTEND;VALUE=DATE:20261226',
        'SUMMARY:Office closed',
        'LOCATION:HQ\\, 3rd floor',
        'STATUS:CANCELLED',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\n'),
    );
    expect(parsed).toEqual({
      title: 'Cancelled: Office closed',
      body: '',
      description: undefined,
      location: 'HQ, 3rd floor',
      kind: 'event',
      start: new Date(2026, 11, 25),
      end: undefined,
      allDay: true,
      completed: false,
    });
  });

  it('reads a VTODO with a DUE time as a task', () => {
    const parsed = parseIcs(
      'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nSUMMARY:Send slides\r\nDUE:20261112T170000Z\r\nEND:VTODO\r\nEND:VCALENDAR\r\n',
    );
    expect(parsed).toMatchObject({
      title: 'Send slides',
      kind: 'task',
      completed: false,
    });
    expect(parsed?.start.toISOString()).toBe('2026-11-12T17:00:00.000Z');
  });

  it('marks a completed VTODO and names an untitled one as a task', () => {
    const parsed = parseIcs(
      'BEGIN:VCALENDAR\nBEGIN:VTODO\nDUE:20261112T170000Z\nSTATUS:COMPLETED\nCOMPLETED:20261110T080000Z\nEND:VTODO\nEND:VCALENDAR',
    );
    expect(parsed).toMatchObject({
      title: 'Untitled task',
      completed: true,
      completedAt: new Date('2026-11-10T08:00:00.000Z'),
    });
  });

  it('skips an entry nested inside another component', () => {
    const parsed = parseIcs(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VTIMEZONE',
        'BEGIN:VEVENT',
        'SUMMARY:nested',
        'DTSTART:20260101T000000Z',
        'END:VEVENT',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        'SUMMARY:real',
        'DTSTART:20261109T180000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\n'),
    );
    expect(parsed?.title).toBe('real');
  });

  it('returns null for non-calendar text or an entry without a start', () => {
    expect(parseIcs('hello')).toBeNull();
    expect(
      parseIcs(
        'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:x\nEND:VEVENT\nEND:VCALENDAR',
      ),
    ).toBeNull();
  });

  it('ignores an entry that sits outside the VCALENDAR block', () => {
    expect(
      parseIcs(
        'BEGIN:VEVENT\nSUMMARY:x\nDTSTART:20261109T180000Z\nEND:VEVENT\nBEGIN:VCALENDAR\nEND:VCALENDAR',
      ),
    ).toBeNull();
  });
});

describe('isCalendarFile', () => {
  it('matches by mime type or extension', () => {
    expect(isCalendarFile(new File([''], 'invite.ics', { type: '' }))).toBe(
      true,
    );
    expect(isCalendarFile(new File([''], 'x', { type: 'text/calendar' }))).toBe(
      true,
    );
    expect(
      isCalendarFile(new File([''], 'x.pdf', { type: 'application/pdf' })),
    ).toBe(false);
  });
});
