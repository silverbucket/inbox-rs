import { describe, expect, it } from 'vitest';
import { normalizeMetadata } from './link-metadata';

describe('normalizeMetadata event', () => {
  it('keeps a well-formed page event', () => {
    expect(
      normalizeMetadata({
        type: 'page',
        event: {
          name: ' Tech Talks ',
          startDate: '2026-11-09T18:00:00-06:00',
          endDate: '2026-11-09T20:00:00-06:00',
          location: 'Austin, TX',
          status: 'scheduled',
        },
      }),
    ).toEqual({
      title: undefined,
      description: undefined,
      image: undefined,
      siteName: undefined,
      favicon: undefined,
      event: {
        name: 'Tech Talks',
        startDate: '2026-11-09T18:00:00-06:00',
        endDate: '2026-11-09T20:00:00-06:00',
        location: 'Austin, TX',
      },
    });
  });

  it('drops an event without a parseable start', () => {
    expect(
      normalizeMetadata({ event: { name: 'X', startDate: 'soon' } }),
    ).toBeNull();
    // Date.parse would roll this over to March 2.
    expect(
      normalizeMetadata({ event: { name: 'X', startDate: '2026-02-30' } }),
    ).toBeNull();
    expect(
      normalizeMetadata({
        event: { name: 'X', startDate: '2026-02-30T10:00:00-06:00' },
      }),
    ).toBeNull();
    expect(
      normalizeMetadata({ title: 'T', event: { name: 'X' } })?.event,
    ).toBeUndefined();
  });

  it('drops an unparseable end date but keeps the event', () => {
    expect(
      normalizeMetadata({
        event: { name: 'X', startDate: '2026-11-09', endDate: 'later' },
      })?.event,
    ).toEqual({
      name: 'X',
      startDate: '2026-11-09',
      endDate: undefined,
      location: undefined,
    });
  });
});
