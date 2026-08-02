import type { InboxItem, NoteItem, TodoItem } from '@inbox-rs/rs-module';
import { describe, expect, it } from 'vitest';
import { buildIcs, escapeText, foldLine } from './ics';

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
