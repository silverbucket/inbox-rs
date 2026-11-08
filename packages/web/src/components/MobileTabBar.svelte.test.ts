// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    appConfig: writable({}),
    sortedItems: writable([{ id: '1' }, { id: '2' }]),
    updateConfig: vi.fn().mockResolvedValue(undefined),
  };
});

import * as stores from '../lib/stores';
import MobileTabBar from './MobileTabBar.svelte';

describe('MobileTabBar', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    stores.appConfig.set({});
    vi.mocked(stores.updateConfig).mockClear();
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  const button = (name: string) =>
    [...host.querySelectorAll('button')].find(
      (b) =>
        b.getAttribute('aria-label') === name ||
        b.querySelector('.label')?.textContent === name,
    ) as HTMLButtonElement;

  function render(page: string, extra: Record<string, unknown> = {}) {
    const props = {
      page,
      planCount: 3,
      navTo: vi.fn(),
      oncapture: vi.fn(),
      ...extra,
    };
    component = mount(MobileTabBar, { target: host, props: props as never });
    flushSync();
    return props;
  }

  it('shows inbox and plan counts', () => {
    render('inbox');
    expect(button('Inbox').textContent).toContain('2');
    expect(button('Plan').textContent).toContain('3');
    expect(button('Inbox').getAttribute('aria-current')).toBe('page');
  });

  it('marks Today on the Todos page by default, Plan for other views', () => {
    render('todos');
    expect(button('Today').getAttribute('aria-current')).toBe('page');
    expect(button('Plan').hasAttribute('aria-current')).toBe(false);
    stores.appConfig.set({ todosView: 'board' });
    flushSync();
    expect(button('Plan').getAttribute('aria-current')).toBe('page');
  });

  it('opens Todos with the right view', () => {
    const props = render('inbox');
    button('Plan').click();
    expect(props.navTo).toHaveBeenCalledWith('todos');
    expect(stores.updateConfig).toHaveBeenCalledWith({ todosView: 'horizon' });
    vi.mocked(stores.updateConfig).mockClear();
    stores.appConfig.set({ todosView: 'horizon' });
    flushSync();
    button('Today').click();
    expect(stores.updateConfig).toHaveBeenCalledWith({ todosView: 'today' });
  });

  it('names the central action for adding a todo on Todos', () => {
    const props = render('todos');
    button('New todo').click();
    expect(props.oncapture).toHaveBeenCalledOnce();
  });

  it('opens capture', () => {
    const props = render('inbox');
    button('Capture').click();
    expect(props.oncapture).toHaveBeenCalled();
  });
});
