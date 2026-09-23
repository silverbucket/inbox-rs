// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchSockethubInfo } = vi.hoisted(() => ({
  fetchSockethubInfo: vi.fn(),
}));

vi.mock('../../lib/link-metadata', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/link-metadata')>();
  return {
    ...actual,
    fetchSockethubInfo,
  };
});

vi.mock('../../lib/rs', () => ({
  default: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn(),
    on: vi.fn(),
    removeEventListener: vi.fn(),
  },
}));

vi.mock('../../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    connected: writable(false),
    authorizationRequired: writable(false),
    connectionStatus: writable('Not connected'),
    syncing: writable(false),
    userAddress: writable(''),
    userSettings: writable({}),
    updateUserSettings: vi.fn(),
  };
});

import type { Writable } from 'svelte/store';
import { DEFAULT_SOCKETHUB_ENDPOINT } from '../../lib/link-metadata';
import rs from '../../lib/rs';
import {
  authorizationRequired,
  connected,
  connectionStatus,
  updateUserSettings,
  userAddress,
  userSettings,
} from '../../lib/stores';
import AccountSettings from './AccountSettings.svelte';

const w = <T>(store: unknown) => store as Writable<T>;

describe('AccountSettings Sockethub status', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    w<boolean>(connected).set(false);
    w<boolean>(authorizationRequired).set(false);
    w<string>(connectionStatus).set('Not connected');
    w<string>(userAddress).set('');
    w<Record<string, unknown>>(userSettings).set({});
    fetchSockethubInfo.mockResolvedValue(null);
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
    vi.useRealTimers();
  });

  function render() {
    component = mount(AccountSettings, { target: host });
    flushSync();
  }

  const statusPill = () =>
    host.querySelector('.server-info .pill') as HTMLSpanElement | null;
  const platformLabels = () =>
    Array.from(host.querySelectorAll('.platforms span')).map((node) =>
      node.textContent?.replace(/\s+/g, ' ').trim(),
    );

  async function settleProbe() {
    await vi.advanceTimersByTimeAsync(300);
    await flushSync();
  }

  it('shows Checking… while the probe is in flight', async () => {
    fetchSockethubInfo.mockImplementation(
      () =>
        new Promise(() => {
          /* pending */
        }),
    );
    render();
    await settleProbe();
    expect(statusPill()?.textContent).toBe('Checking…');
    expect(statusPill()?.classList.contains('ok')).toBe(false);
  });

  it('shows API version and platform list when the server reports', async () => {
    fetchSockethubInfo.mockResolvedValue({
      name: 'sockethub',
      apiVersion: 5,
      platforms: [
        { id: 'metadata', apiVersion: 5 },
        { id: 'caldav', apiVersion: 5 },
      ],
    });
    render();
    await settleProbe();
    expect(fetchSockethubInfo).toHaveBeenCalledWith(DEFAULT_SOCKETHUB_ENDPOINT);
    expect(statusPill()?.textContent).toBe('API v5');
    expect(statusPill()?.classList.contains('ok')).toBe(true);
    expect(platformLabels()).toEqual(['metadata API v5', 'caldav API v5']);
  });

  it('shows API version unavailable when the descriptor is missing', async () => {
    fetchSockethubInfo.mockResolvedValue(null);
    render();
    await settleProbe();
    expect(statusPill()?.textContent).toBe('API version unavailable');
    expect(statusPill()?.classList.contains('ok')).toBe(false);
    expect(host.querySelector('.platforms')).toBeNull();
  });

  it('shows Unavailable when the probe throws', async () => {
    fetchSockethubInfo.mockRejectedValue(new Error('network down'));
    render();
    await settleProbe();
    expect(statusPill()?.textContent).toBe('Unavailable');
    expect(statusPill()?.classList.contains('ok')).toBe(false);
  });

  it('shows Unavailable for a blank custom endpoint without probing', async () => {
    render();
    flushSync();
    (
      host.querySelector('button[onclick]') ??
      Array.from(host.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('My own server'),
      )
    )?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    await settleProbe();
    expect(fetchSockethubInfo).not.toHaveBeenCalled();
    expect(statusPill()?.textContent).toBe('Unavailable');
  });

  it('re-probes when the custom endpoint changes', async () => {
    fetchSockethubInfo.mockResolvedValue({
      name: 'sockethub',
      apiVersion: 4,
      platforms: [{ id: 'metadata', apiVersion: 4 }],
    });
    render();
    await settleProbe();
    expect(fetchSockethubInfo).toHaveBeenCalledTimes(1);

    const ownServer = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('My own server'),
    );
    ownServer?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();

    const input = host.querySelector('#sockethub-endpoint') as HTMLInputElement;
    input.value = 'https://relay.example/sockethub-http';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    fetchSockethubInfo.mockResolvedValue({
      name: 'sockethub',
      apiVersion: 6,
      platforms: [{ id: 'metadata', apiVersion: 6 }],
    });
    await settleProbe();
    expect(fetchSockethubInfo).toHaveBeenLastCalledWith(
      'https://relay.example/sockethub-http',
    );
    expect(statusPill()?.textContent).toBe('API v6');
  });

  it('shows reconnect required state while keeping the connected account visible', () => {
    w<boolean>(connected).set(true);
    w<string>(userAddress).set('alice@example.com');
    w<boolean>(authorizationRequired).set(true);
    w<string>(connectionStatus).set('Reconnect required');
    render();
    const identityPill = host.querySelector(
      '.identity .pill',
    ) as HTMLSpanElement;
    expect(identityPill?.textContent).toBe('Reconnect required');
    expect(identityPill?.classList.contains('ok')).toBe(false);
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);
    const reconnectButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Reconnect',
    );
    expect(reconnectButton).toBeDefined();
    reconnectButton?.click();
    expect(rs.reconnect).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('alice@example.com');
  });

  it('reports when reconnection cannot start from Account settings', () => {
    w<boolean>(connected).set(true);
    w<boolean>(authorizationRequired).set(true);
    w<string>(connectionStatus).set('Reconnect required');
    vi.mocked(rs.reconnect).mockImplementationOnce(() => {
      throw new Error('Unavailable');
    });
    render();
    Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent === 'Reconnect')
      ?.click();
    flushSync();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'Could not start reconnection. Please try again.',
    );
  });

  it('invalidates an in-flight result as soon as the endpoint changes', async () => {
    let resolveDefault: (value: {
      name: 'sockethub';
      apiVersion: number;
      platforms: Array<{ id: string; apiVersion: number }>;
    }) => void = () => {};
    fetchSockethubInfo.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDefault = resolve;
        }),
    );
    render();
    await settleProbe();

    const ownServer = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('My own server'),
    );
    ownServer?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    const input = host.querySelector('#sockethub-endpoint') as HTMLInputElement;
    input.value = 'https://new.example/sockethub-http';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    resolveDefault({
      name: 'sockethub',
      apiVersion: 4,
      platforms: [{ id: 'metadata', apiVersion: 4 }],
    });
    await Promise.resolve();
    flushSync();

    expect(statusPill()?.textContent).toBe('Checking…');
    expect(platformLabels()).toEqual([]);
  });
});

describe('AccountSettings initials', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    fetchSockethubInfo.mockResolvedValue(null);
    w<boolean>(connected).set(true);
    w<Record<string, unknown>>(userSettings).set({ abbreviation: 'NJ' });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(AccountSettings, { target: host });
    flushSync();
  });

  afterEach(() => {
    if (component) unmount(component);
    component = undefined;
    host.remove();
  });

  const input = () =>
    host.querySelector('input[aria-label="Initials"]') as HTMLInputElement;

  it('seeds the field from the stored abbreviation', () => {
    expect(input().value).toBe('NJ');
  });

  it('stays empty after the user clears it and saves as unset on blur', async () => {
    const field = input();
    field.value = '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(field.value).toBe('');

    field.dispatchEvent(new FocusEvent('blur'));
    flushSync();
    expect(field.value).toBe('');
    expect(updateUserSettings).toHaveBeenCalledWith({
      abbreviation: undefined,
    });
  });

  it('follows a stored abbreviation that changes later', () => {
    w<Record<string, unknown>>(userSettings).set({ abbreviation: 'AB' });
    flushSync();
    expect(input().value).toBe('AB');
  });

  it('does not snap back to the stored abbreviation while editing', () => {
    const field = input();
    field.value = 'N';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(field.value).toBe('N');
  });

  it('persists a new abbreviation on blur', () => {
    const field = input();
    field.value = 'xy';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    field.dispatchEvent(new FocusEvent('blur'));
    flushSync();

    expect(field.value).toBe('XY');
    expect(updateUserSettings).toHaveBeenCalledWith({
      abbreviation: 'XY',
    });
  });
});
