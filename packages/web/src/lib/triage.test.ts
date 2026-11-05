import type { Collection, InboxItem } from '@inbox-rs/rs-module';
import { describe, expect, it } from 'vitest';
import {
  ageBucket,
  buildSiteIndex,
  findDuplicates,
  groupInbox,
  lacksTitle,
  nextInQueue,
  previousInQueue,
  quickSuggestion,
  relativeAge,
  suggestedDate,
} from './triage';

// Wednesday, November 4, 2026, mid-morning local time.
const NOW = new Date(2026, 10, 4, 10, 30);

const at = (y: number, m: number, d: number, h = 9) =>
  new Date(y, m, d, h).toISOString();

const note = (id: string, title: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'note',
    title,
    body: '',
    createdAt: at(2026, 10, 4),
    ...extra,
  }) as unknown as InboxItem;

const bookmark = (
  id: string,
  url: string,
  title = 'A page',
  extra: Record<string, unknown> = {},
) =>
  ({
    id,
    type: 'bookmark',
    title,
    url,
    createdAt: at(2026, 10, 4),
    ...extra,
  }) as unknown as InboxItem;

const collection = (id: string, name: string, itemIds: string[] = []) =>
  ({ id, name, itemIds, createdAt: at(2026, 0, 1) }) as unknown as Collection;

describe('age groups', () => {
  it('buckets by capture time', () => {
    expect(ageBucket({ createdAt: at(2026, 10, 4) }, NOW)).toBe('new');
    // Yesterday, early morning, still counts as new.
    expect(ageBucket({ createdAt: at(2026, 10, 3, 0) }, NOW)).toBe('new');
    expect(ageBucket({ createdAt: at(2026, 10, 2, 23) }, NOW)).toBe('earlier');
    expect(ageBucket({ createdAt: at(2026, 8, 10) }, NOW)).toBe('earlier');
    expect(ageBucket({ createdAt: at(2026, 7, 28) }, NOW)).toBe('stale');
    expect(ageBucket({ createdAt: 'junk' }, NOW)).toBe('earlier');
  });

  it('keeps display order inside each group and skips empty ones', () => {
    const items = [
      note('a', 'A'),
      note('old', 'Old', { createdAt: at(2026, 7, 1) }),
      note('b', 'B', { createdAt: at(2026, 9, 30) }),
      note('c', 'C', { createdAt: at(2026, 9, 15) }),
    ];
    const groups = groupInbox(items, NOW);
    expect(groups.map((g) => g.key)).toEqual(['new', 'earlier', 'stale']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['b', 'c']);
    expect(groups[1].hint).toMatch(/·\s2$/);
    expect(groupInbox([note('a', 'A')], NOW).map((g) => g.key)).toEqual([
      'new',
    ]);
  });
});

describe('relativeAge', () => {
  it('reads like a person would say it', () => {
    expect(relativeAge(at(2026, 10, 4, 8), NOW)).toBe('today');
    expect(relativeAge(at(2026, 10, 3, 23), NOW)).toBe('yesterday');
    expect(relativeAge(at(2026, 9, 30), NOW)).toBe('5 days ago');
    expect(relativeAge(at(2026, 9, 15), NOW)).toBe(
      new Date(2026, 9, 15).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
    );
    expect(relativeAge(at(2025, 9, 15), NOW)).toContain('2025');
    expect(relativeAge('junk', NOW)).toBe('');
  });
});

describe('findDuplicates', () => {
  it('pairs notes with the same words, ignoring markdown', () => {
    const a = note(
      'a',
      'Minnesota has faced a major, multi-year fraud scandal',
    );
    const b = note(
      'b',
      '**Minnesota has faced a major, multi-year fraud scandal**',
    );
    const c = note('c', 'Something else entirely, long enough to count');
    const dups = findDuplicates([a, b, c]);
    expect(dups.get('a')?.id).toBe('b');
    expect(dups.get('b')?.id).toBe('a');
    expect(dups.has('c')).toBe(false);
  });

  it('compares bodies when titles were cut at different lengths', () => {
    const body =
      'Minnesota has faced a major, multi-year fraud scandal involving programs';
    const a = note('a', 'Minnesota has faced a major, multi-year fraud scan', {
      body,
    });
    const b = note('b', '**Minnesota has faced a major, multi-year fraud sc', {
      body: `**${body}**¹`,
    });
    expect(findDuplicates([a, b]).get('a')?.id).toBe('b');
  });

  it('pairs bookmarks to the same page', () => {
    const dups = findDuplicates([
      bookmark('a', 'https://www.example.org/post/'),
      bookmark('b', 'http://example.org/post#comments'),
      bookmark('c', 'https://example.org/other'),
    ]);
    expect(dups.get('a')?.id).toBe('b');
    expect(dups.has('c')).toBe(false);
  });

  it('ignores short notes that match by accident', () => {
    expect(findDuplicates([note('a', 'Idea'), note('b', 'idea')]).size).toBe(0);
  });
});

describe('lacksTitle', () => {
  it('flags bookmarks titled with nothing but their site', () => {
    expect(
      lacksTitle(bookmark('a', 'https://www.reddit.com/r/x', 'reddit')),
    ).toBe(true);
    expect(lacksTitle(bookmark('a', 'https://reddit.com/r/x', ''))).toBe(true);
    expect(
      lacksTitle(
        bookmark('a', 'https://reddit.com/r/x', 'https://reddit.com/r/x'),
      ),
    ).toBe(true);
    expect(
      lacksTitle(bookmark('a', 'https://reddit.com/r/x', 'A good thread')),
    ).toBe(false);
    expect(lacksTitle(note('a', ''))).toBe(false);
  });
});

describe('suggestedDate', () => {
  const key = (d: Date | null) =>
    d ? [d.getFullYear(), d.getMonth() + 1, d.getDate()] : null;

  it('finds written dates', () => {
    expect(key(suggestedDate(note('a', 'Dinner on Nov 26'), NOW))).toEqual([
      2026, 11, 26,
    ]);
    expect(key(suggestedDate(note('a', 'Gig 3rd December'), NOW))).toEqual([
      2026, 12, 3,
    ]);
    expect(key(suggestedDate(note('a', 'Renew by 2027-01-15'), NOW))).toEqual([
      2027, 1, 15,
    ]);
    expect(
      key(
        suggestedDate(
          note('a', 'Party', { body: 'see you **Sat, Nov 7**' }),
          NOW,
        ),
      ),
    ).toEqual([2026, 11, 7]);
  });

  it('rolls a past month/day without a year to next year', () => {
    expect(key(suggestedDate(note('a', 'Birthday March 3'), NOW))).toEqual([
      2027, 3, 3,
    ]);
    // Today itself still counts.
    expect(key(suggestedDate(note('a', 'Call Nov 4'), NOW))).toEqual([
      2026, 11, 4,
    ]);
  });

  it('ignores past, far-off and impossible dates', () => {
    expect(suggestedDate(note('a', 'Notes from 2025-03-01'), NOW)).toBeNull();
    expect(suggestedDate(note('a', 'Retire 2040-01-01'), NOW)).toBeNull();
    expect(suggestedDate(note('a', 'Feb 31 is not a day'), NOW)).toBeNull();
    expect(
      suggestedDate(note('a', 'May the force be with you'), NOW),
    ).toBeNull();
  });

  it('takes the first date written', () => {
    expect(key(suggestedDate(note('a', 'Dec 1 or Nov 20'), NOW))).toEqual([
      2026, 12, 1,
    ]);
  });
});

describe('quickSuggestion', () => {
  const filed = bookmark('f', 'https://github.com/a/b');
  const all = { f: filed } as Record<string, InboxItem>;
  const skills = collection('skills', 'AI Skills', ['f']);
  const politics = collection('pol', 'Politics');
  const cols = [skills, politics];
  const index = buildSiteIndex(cols, all);

  it('prefers where the site is already filed', () => {
    expect(
      quickSuggestion(bookmark('x', 'https://github.com/c/d'), index, cols)?.id,
    ).toBe('skills');
  });

  it('falls back to a collection named in the title', () => {
    expect(
      quickSuggestion(note('x', 'Politics this week'), index, cols)?.id,
    ).toBe('pol');
    expect(quickSuggestion(note('x', 'Geopolitics'), index, cols)).toBeNull();
  });
});

describe('queue walking', () => {
  const queue = ['a', 'b', 'c', 'd'];
  const gone = new Set(['b']);
  const inInbox = (id: string) => !gone.has(id);

  it('skips cards that left the inbox', () => {
    expect(nextInQueue(queue, 1, inInbox)).toBe(2);
    expect(previousInQueue(queue, 2, inInbox)).toBe(0);
    expect(nextInQueue(queue, 4, inInbox)).toBe(-1);
    expect(previousInQueue(queue, 0, inInbox)).toBe(-1);
  });
});
