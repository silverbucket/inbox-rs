// @vitest-environment jsdom
import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLayout, layout, setLayout, setLayoutPersisted } from './layout';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('getLayout', () => {
  it('defaults to classic when nothing is stored', () => {
    expect(getLayout()).toBe('classic');
  });

  it('returns a stored valid layout', () => {
    localStorage.setItem('inbox-rs:layout', 'sidebar');
    expect(getLayout()).toBe('sidebar');
  });

  it('falls back to classic for an unrecognised value', () => {
    localStorage.setItem('inbox-rs:layout', 'bogus');
    expect(getLayout()).toBe('classic');
  });

  it('falls back to classic when storage access throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(getLayout()).toBe('classic');
  });
});

describe('setLayout', () => {
  it('persists the chosen layout', () => {
    setLayout('sidebar');
    expect(localStorage.getItem('inbox-rs:layout')).toBe('sidebar');
    expect(getLayout()).toBe('sidebar');
  });

  it('ignores blocked storage without throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => setLayout('sidebar')).not.toThrow();
  });
});

describe('setLayoutPersisted', () => {
  afterEach(() => setLayoutPersisted('classic'));

  it('updates the reactive store and persists to storage', () => {
    setLayoutPersisted('sidebar');
    expect(get(layout)).toBe('sidebar');
    expect(localStorage.getItem('inbox-rs:layout')).toBe('sidebar');

    setLayoutPersisted('classic');
    expect(get(layout)).toBe('classic');
    expect(localStorage.getItem('inbox-rs:layout')).toBe('classic');
  });
});
