// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    authorizationRequired: writable(false),
    connected: writable(false),
    connectionStatus: writable('Not connected'),
    userAddress: writable(''),
    userSettings: writable({}),
  };
});

import type { Writable } from 'svelte/store';
import {
  authorizationRequired,
  connected,
  connectionStatus,
  userAddress,
  userSettings,
} from '../lib/stores';
import UserMenu from './UserMenu.svelte';

const w = <T>(store: unknown) => store as Writable<T>;

describe('UserMenu connection status', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount>;

  beforeEach(() => {
    w<boolean>(authorizationRequired).set(false);
    w<boolean>(connected).set(false);
    w<string>(connectionStatus).set('Not connected');
    w<string>(userAddress).set('');
    w<Record<string, unknown>>(userSettings).set({});
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(UserMenu, {
      target: host,
      props: { onopensettings: vi.fn() },
    });
    flushSync();
  });

  afterEach(() => {
    unmount(component);
    host.remove();
  });

  function trigger() {
    return host.querySelector('button.trigger') as HTMLButtonElement;
  }

  function statusDot() {
    return host.querySelector('.status-dot') as HTMLSpanElement;
  }

  it('labels disconnected and connected states', () => {
    expect(trigger().getAttribute('aria-label')).toBe(
      'User menu — disconnected',
    );
    expect(trigger().title).toBe('Not connected');
    expect(statusDot().classList.contains('connected')).toBe(false);
    expect(statusDot().classList.contains('syncing')).toBe(false);

    flushSync(() => {
      w<boolean>(connected).set(true);
      w<string>(userAddress).set('alice@example.com');
      w<string>(connectionStatus).set('Connected');
    });
    expect(trigger().getAttribute('aria-label')).toBe('User menu — connected');
    expect(trigger().title).toBe('Connected');
    expect(statusDot().classList.contains('connected')).toBe(true);
    expect(statusDot().classList.contains('syncing')).toBe(false);
  });

  it('shows reconnect, offline, and unreachable states without a green sync dot', () => {
    flushSync(() => {
      w<boolean>(connected).set(true);
      w<string>(userAddress).set('alice@example.com');
      w<boolean>(authorizationRequired).set(true);
      w<string>(connectionStatus).set('Reconnect required');
    });
    expect(trigger().getAttribute('aria-label')).toBe(
      'User menu — reconnect required',
    );
    expect(statusDot().classList.contains('unauthorized')).toBe(true);
    expect(statusDot().classList.contains('connected')).toBe(false);
    expect(statusDot().classList.contains('syncing')).toBe(false);

    flushSync(() => {
      w<boolean>(authorizationRequired).set(false);
      w<string>(connectionStatus).set('Offline');
    });
    expect(trigger().getAttribute('aria-label')).toBe('User menu — offline');
    expect(statusDot().classList.contains('connected')).toBe(false);
    expect(statusDot().classList.contains('syncing')).toBe(false);

    flushSync(() => {
      w<string>(connectionStatus).set('Storage unreachable');
    });
    expect(trigger().getAttribute('aria-label')).toBe(
      'User menu — storage unreachable',
    );
    expect(statusDot().classList.contains('connected')).toBe(false);
    expect(statusDot().classList.contains('syncing')).toBe(false);
  });

  it('only pulses the status dot while actively syncing', () => {
    flushSync(() => {
      w<boolean>(connected).set(true);
      w<string>(userAddress).set('alice@example.com');
      w<string>(connectionStatus).set('Syncing…');
    });
    expect(trigger().title).toBe('Syncing…');
    expect(statusDot().classList.contains('syncing')).toBe(true);
    expect(statusDot().classList.contains('connected')).toBe(false);
  });
});
