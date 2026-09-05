// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const build = vi.hoisted(() => ({
  buildDate: '2026-09-05 12:00 UTC',
  footerVersionLabel: 'v9.9.9',
  isStagingBuild: false,
}));

vi.mock('../lib/build-info', () => ({
  get buildDate() {
    return build.buildDate;
  },
  get footerVersionLabel() {
    return build.footerVersionLabel;
  },
  get isStagingBuild() {
    return build.isStagingBuild;
  },
}));

import AppFooter from './AppFooter.svelte';

describe('AppFooter', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    build.buildDate = '2026-09-05 12:00 UTC';
    build.footerVersionLabel = 'v9.9.9';
    build.isStagingBuild = false;
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  function render(props: { pluginsActive?: boolean; centered?: boolean } = {}) {
    component = mount(AppFooter, { target: host, props });
    flushSync();
  }

  it('shows the brand, release version and build date', () => {
    render();
    expect(host.querySelector('.footer-brand')?.textContent).toBe('Inbox RS');
    const version = host.querySelector('.footer-version');
    expect(version?.textContent).toBe('v9.9.9');
    expect(version?.classList.contains('staging')).toBe(false);
    expect(host.querySelector('.footer-date')?.textContent).toBe(
      '2026-09-05 12:00 UTC',
    );
  });

  it('marks a staging bundle so it cannot pass for a release', () => {
    build.footerVersionLabel = 'Staging';
    build.isStagingBuild = true;
    render();
    const version = host.querySelector('.footer-version');
    expect(version?.textContent).toBe('Staging');
    expect(version?.classList.contains('staging')).toBe(true);
  });

  it('omits the build date when the bundle has none', () => {
    build.buildDate = '';
    render();
    expect(host.querySelector('.footer-date')).toBeNull();
  });

  it('highlights the Plugins link only on the plugins page', () => {
    render();
    const link = () =>
      Array.from(host.querySelectorAll('a.footer-link')).find((a) =>
        a.textContent?.includes('Plugins'),
      );
    expect(link()?.classList.contains('active')).toBe(false);

    unmount(component!);
    render({ pluginsActive: true });
    expect(link()?.classList.contains('active')).toBe(true);
  });
});
