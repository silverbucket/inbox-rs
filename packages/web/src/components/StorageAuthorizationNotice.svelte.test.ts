// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/rs', () => ({ default: { reconnect: vi.fn() } }));
vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store');
  return { authorizationRequired: writable(false) };
});

import rs from '../lib/rs';
import { authorizationRequired } from '../lib/stores';
import StorageAuthorizationNotice from './StorageAuthorizationNotice.svelte';

describe('storage authorization warning', () => {
  let host: HTMLElement;
  let component: ReturnType<typeof mount>;

  beforeEach(() => {
    vi.resetAllMocks();
    authorizationRequired.set(false);
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(StorageAuthorizationNotice, { target: host });
    flushSync();
  });

  afterEach(() => {
    unmount(component);
    host.remove();
  });

  it('remains visible through reconnect until authorization is restored', () => {
    expect(host.querySelector('[role="alert"]')).toBeNull();
    flushSync(() => authorizationRequired.set(true));
    expect(host.textContent).toContain('expired or been revoked');
    expect(host.textContent).toContain('cannot sync');
    host.querySelector('button')?.click();
    expect(rs.reconnect).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    flushSync(() => authorizationRequired.set(false));
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps reconnect available if starting authorization throws', () => {
    vi.mocked(rs.reconnect).mockImplementation(() => {
      throw new Error('Unavailable');
    });
    flushSync(() => authorizationRequired.set(true));
    host.querySelector('button')?.click();
    flushSync();
    expect(host.textContent).toContain('Could not start reconnection');
    expect(host.querySelector('button')?.disabled).toBe(false);
  });
});
