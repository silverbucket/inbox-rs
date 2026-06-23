import { describe, expect, it, vi } from 'vitest';
import {
  formatRoute,
  pageUsesFilters,
  parseHash,
  replaceRouteHash,
} from './route';

describe('parseHash', () => {
  it('returns inbox for empty/root hash', () => {
    expect(parseHash('')).toEqual({ page: 'inbox' });
    expect(parseHash('#')).toEqual({ page: 'inbox' });
    expect(parseHash('#/')).toEqual({ page: 'inbox' });
    expect(parseHash('#/inbox')).toEqual({ page: 'inbox' });
  });

  it('parses static routes', () => {
    expect(parseHash('#/todos')).toEqual({ page: 'todos' });
    expect(parseHash('#/collections')).toEqual({ page: 'collections' });
    expect(parseHash('#/plugins')).toEqual({ page: 'plugins' });
  });

  it('falls back to inbox for unknown routes', () => {
    expect(parseHash('#/wat')).toEqual({ page: 'inbox' });
    expect(parseHash('#/some/deep/path')).toEqual({ page: 'inbox' });
  });

  it('redirects legacy #/group/:id to collections', () => {
    expect(parseHash('#/group/g123')).toEqual({ page: 'collections' });
  });

  it('parses single group filter', () => {
    expect(parseHash('#/todos?g=g1')).toEqual({
      page: 'todos',
      groupFilters: ['g1'],
    });
  });

  it('parses comma-separated group filters', () => {
    expect(parseHash('#/collections?g=g1,g2,g3')).toEqual({
      page: 'collections',
      groupFilters: ['g1', 'g2', 'g3'],
    });
  });

  it('treats g= (empty) as explicit empty list (all hidden)', () => {
    expect(parseHash('#/todos?g=')).toEqual({
      page: 'todos',
      groupFilters: [],
    });
  });

  it('treats absent g param as undefined (default-all behaviour)', () => {
    expect(parseHash('#/todos')).toEqual({ page: 'todos' });
    expect(parseHash('#/todos?other=1')).toEqual({ page: 'todos' });
  });

  it('trims whitespace and drops empty entries', () => {
    expect(parseHash('#/todos?g=g1, ,g2,')).toEqual({
      page: 'todos',
      groupFilters: ['g1', 'g2'],
    });
  });

  it('accepts hash without leading #', () => {
    expect(parseHash('/todos?g=g1')).toEqual({
      page: 'todos',
      groupFilters: ['g1'],
    });
  });
});

describe('formatRoute', () => {
  it('formats static routes without filters', () => {
    expect(formatRoute({ page: 'inbox' })).toBe('#/');
    expect(formatRoute({ page: 'todos' })).toBe('#/todos');
    expect(formatRoute({ page: 'collections' })).toBe('#/collections');
    expect(formatRoute({ page: 'plugins' })).toBe('#/plugins');
  });

  it('omits filter param on pages that do not use filters', () => {
    expect(formatRoute({ page: 'inbox', groupFilters: ['g1'] })).toBe('#/');
    expect(formatRoute({ page: 'plugins', groupFilters: ['g1'] })).toBe(
      '#/plugins',
    );
  });

  it('emits comma-separated filters on filter pages', () => {
    expect(formatRoute({ page: 'todos', groupFilters: ['g1', 'g2'] })).toBe(
      '#/todos?g=g1,g2',
    );
    expect(formatRoute({ page: 'collections', groupFilters: ['x'] })).toBe(
      '#/collections?g=x',
    );
  });

  it('emits g= for an explicit empty filter list', () => {
    expect(formatRoute({ page: 'todos', groupFilters: [] })).toBe('#/todos?g=');
  });

  it('round-trips with parseHash', () => {
    const inputs: Array<Parameters<typeof formatRoute>[0]> = [
      { page: 'inbox' },
      { page: 'todos' },
      { page: 'todos', groupFilters: ['g1'] },
      { page: 'todos', groupFilters: ['g1', 'g2', 'g3'] },
      { page: 'collections' },
      { page: 'collections', groupFilters: [] },
      { page: 'plugins' },
    ];
    for (const route of inputs) {
      expect(parseHash(formatRoute(route))).toEqual(route);
    }
  });
});

describe('pageUsesFilters', () => {
  it('is true for todos and collections', () => {
    expect(pageUsesFilters('todos')).toBe(true);
    expect(pageUsesFilters('collections')).toBe(true);
  });

  it('is false for inbox and plugins', () => {
    expect(pageUsesFilters('inbox')).toBe(false);
    expect(pageUsesFilters('plugins')).toBe(false);
  });
});

describe('replaceRouteHash', () => {
  it('calls replaceState when the hash differs', () => {
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: { hash: '#/' },
      history: { replaceState },
    });
    replaceRouteHash('#/todos');
    expect(replaceState).toHaveBeenCalledWith(null, '', '#/todos');
  });

  it('skips replaceState when the hash already matches', () => {
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: { hash: '#/todos' },
      history: { replaceState },
    });
    replaceRouteHash('#/todos');
    expect(replaceState).not.toHaveBeenCalled();
  });
});
