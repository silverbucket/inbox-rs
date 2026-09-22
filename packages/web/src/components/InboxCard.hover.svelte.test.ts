// @vitest-environment jsdom
import type { BookmarkItem } from '@inbox-rs/rs-module';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    connected: writable(false),
    blobUrls: writable<Record<string, string>>({}),
    loadFileBlobUrl: vi.fn(),
    draggingItemId: writable<string | null>(null),
  };
});
vi.mock('../lib/rs', () => ({
  default: {},
  fetchFileBlobUrl: vi.fn(),
  fetchFileWithAuth: vi.fn(),
}));

import InboxCard from './InboxCard.svelte';

/** Create a bookmark fixture for card styling checks. */
function bookmark(overrides: Partial<BookmarkItem> = {}): BookmarkItem {
  return {
    id: 'b1',
    type: 'bookmark',
    title: 'Example',
    url: 'https://example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Collect stylesheet rules whose selector passes `matcher`. */
function findCssRules(matcher: (selector: string) => boolean): CSSStyleRule[] {
  const rules: CSSStyleRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSStyleRule && matcher(rule.selectorText)) {
          rules.push(rule);
        }
      }
    } catch {
      // Cross-origin or otherwise inaccessible sheets are ignored.
    }
  }
  return rules;
}

/** True when `:hover` applies directly to `.card`, not a descendant selector. */
function isRootCardHoverSelector(selector: string): boolean {
  const trimmed = selector.trim();
  const hoverIdx = trimmed.indexOf(':hover');
  if (hoverIdx === -1) return false;
  const afterHover = trimmed.slice(hoverIdx + ':hover'.length);
  // Descendant rules like `.card:hover .pin-button` have tokens after `:hover`.
  return afterHover.length === 0 || /^\.svelte-[-\w]+$/.test(afterHover);
}

/** Split shadow layers without splitting commas inside CSS color functions. */
function shadowLayers(value: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      layers.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  layers.push(value.slice(start).trim());
  return layers;
}

describe('shadow layer parsing', () => {
  it.each([
    ['inset 0 0 0 1px var(--accent)', true],
    ['0 0 1px rgba(0, 0, 0, 0.5) inset, inset 0 0 2px red', true],
    ['inset 0 0 1px color-mix(in srgb, var(--accent), white)', true],
    ['inset 0 0 0 1px red, 0 2px 8px rgba(0, 0, 0, 0.5)', false],
    ['0 2px 8px red, inset 0 0 0 1px red', false],
    ['0 1px 2px red', false],
    ['', false],
  ])('checks every layer in %s', (value, expected) => {
    expect(
      shadowLayers(value).every((layer) => /(?:^|\s)inset(?:\s|$)/.test(layer)),
    ).toBe(expected);
  });
});

describe('InboxCard hover styling', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  it('uses an inset-only box-shadow on hover so paint stays inside masonry columns', () => {
    component = mount(InboxCard, {
      target: host,
      props: { item: bookmark(), onselect: () => {} },
    });
    flushSync();

    const hoverRules = findCssRules(
      (selector) =>
        selector.includes('.card') && isRootCardHoverSelector(selector),
    );
    expect(hoverRules.length).toBeGreaterThan(0);

    const boxShadow = hoverRules
      .map((rule) => rule.style.getPropertyValue('box-shadow'))
      .filter(Boolean)
      .join(', ');
    expect(boxShadow).toMatch(/inset\s+0\s+0\s+0\s+1px/);
    for (const layer of shadowLayers(boxShadow)) {
      expect(layer).toMatch(/(?:^|\s)inset(?:\s|$)/);
    }
  });

  it('keeps card focus-visible outlines on the selection button and pin control', () => {
    component = mount(InboxCard, {
      target: host,
      props: { item: bookmark(), onselect: () => {} },
    });
    flushSync();

    const cardSelectFocus = findCssRules(
      (selector) =>
        selector.includes('.card-select') &&
        selector.includes(':focus-visible'),
    );
    expect(cardSelectFocus.length).toBeGreaterThan(0);
    expect(cardSelectFocus[0]?.style.getPropertyValue('outline')).toContain(
      '2px solid',
    );

    const pinFocus = findCssRules(
      (selector) =>
        selector.includes('.pin-button') && selector.includes(':focus-visible'),
    ).find((rule) => rule.style.getPropertyValue('outline'));
    expect(pinFocus).toBeDefined();
    expect(pinFocus?.style.getPropertyValue('outline')).toContain('2px solid');
  });
});
