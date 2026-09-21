// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const build = vi.hoisted(() => ({
  buildDate: '2026-09-05 12:00 UTC',
  versionLabel: 'v9.9.9',
}));

vi.mock('../../lib/build-info', () => ({
  get buildDate() {
    return build.buildDate;
  },
  get versionLabel() {
    return build.versionLabel;
  },
}));

import AboutSettings from './AboutSettings.svelte';

const REPO = 'https://github.com/silverbucket/inbox-rs';

describe('AboutSettings', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    build.buildDate = '2026-09-05 12:00 UTC';
    build.versionLabel = 'v9.9.9';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  function render() {
    component = mount(AboutSettings, { target: host });
    flushSync();
  }

  function link(label: string) {
    return Array.from(host.querySelectorAll('a.btn')).find((a) =>
      a.textContent?.includes(label),
    );
  }

  it("links What's new and Source to the silverbucket GitHub repository", () => {
    render();
    expect(link("What's new")?.getAttribute('href')).toBe(`${REPO}/releases`);
    expect(link('Source')?.getAttribute('href')).toBe(REPO);
    expect(host.innerHTML).not.toContain('67P/inbox-rs');
  });

  it('opens repository links in a new tab', () => {
    render();
    for (const anchor of host.querySelectorAll('a.btn')) {
      expect(anchor.getAttribute('target')).toBe('_blank');
      expect(anchor.getAttribute('rel')).toBe('noreferrer');
    }
  });
});
