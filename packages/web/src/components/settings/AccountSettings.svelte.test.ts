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
    syncing: writable(false),
    userAddress: writable(''),
    userSettings: writable({}),
    updateUserSettings: vi.fn(),
  };
});

import type { Writable } from 'svelte/store';
import { DEFAULT_SOCKETHUB_ENDPOINT } from '../../lib/link-metadata';
import {
  authorizationRequired,
  connected,
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
    render();
    const identityPill = host.querySelector(
      '.identity .pill',
    ) as HTMLSpanElement;
    expect(identityPill?.textContent).toBe('Reconnect required');
    expect(identityPill?.classList.contains('ok')).toBe(false);
    expect(host.textContent).toContain('Reconnect your storage');
    expect(host.textContent).toContain('alice@example.com');
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
