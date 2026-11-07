// @vitest-environment jsdom

import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRestoring, hasStoredSession } from './restoring';

describe('createRestoring', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('with no stored session, clears once local data loads', () => {
    const s = createRestoring({ sessionPending: false });
    expect(get(s.restoring)).toBe(true);
    s.localLoaded();
    expect(get(s.restoring)).toBe(false);
  });

  it('with a stored session, waits for both the local load and connected', () => {
    const s = createRestoring({ sessionPending: true });
    s.localLoaded();
    expect(get(s.restoring)).toBe(true);
    s.sessionSettled(); // connected
    expect(get(s.restoring)).toBe(false);
  });

  it('clears on a not-connected outcome after the local load', () => {
    const s = createRestoring({ sessionPending: true });
    s.sessionSettled(); // not-connected / disconnected / error
    expect(get(s.restoring)).toBe(true);
    s.localLoaded();
    expect(get(s.restoring)).toBe(false);
  });

  it('clears on the safety timeout if nothing resolves', () => {
    const s = createRestoring({ sessionPending: true, timeoutMs: 3000 });
    vi.advanceTimersByTime(2999);
    expect(get(s.restoring)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(get(s.restoring)).toBe(false);
  });
});

describe('hasStoredSession', () => {
  afterEach(() => localStorage.clear());

  it('is true only when the wireclient settings hold a token', () => {
    expect(hasStoredSession()).toBe(false);
    localStorage.setItem(
      'remotestorage:wireclient',
      JSON.stringify({ userAddress: 'a@b' }),
    );
    expect(hasStoredSession()).toBe(false);
    localStorage.setItem(
      'remotestorage:wireclient',
      JSON.stringify({ userAddress: 'a@b', token: 't' }),
    );
    expect(hasStoredSession()).toBe(true);
    localStorage.setItem('remotestorage:wireclient', '{bad');
    expect(hasStoredSession()).toBe(false);
  });
});
