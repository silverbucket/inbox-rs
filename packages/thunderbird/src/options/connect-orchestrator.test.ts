import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `<all_urls>` became an optional permission (see `manifest.test.ts`), so
 * the Options connect flow has to request host access itself. Gecko only
 * honours `browser.permissions.request()` when it's called synchronously
 * from a user input handler, so the storage-origin request (only knowable
 * after a WebFinger fetch) can't happen inside the same async chain as the
 * WebFinger-host request — it has to wait for a fresh click. These tests
 * pin that two-phase contract down: `startConnect` must never call
 * `requestOriginPermission` for the storage origin itself; it reports
 * `needs-storage-permission` and leaves that request to
 * `continueConnectWithStoragePermission`, invoked from a later click.
 */

const { mockDiscoverStorage } = vi.hoisted(() => ({
  mockDiscoverStorage: vi.fn(),
}));

vi.mock('@inbox-rs/rs-module/runtime', async () => {
  const actual = await vi.importActual<
    typeof import('@inbox-rs/rs-module/runtime')
  >('@inbox-rs/rs-module/runtime');
  return { ...actual, discoverStorage: mockDiscoverStorage };
});

import {
  continueConnectWithStoragePermission,
  startConnect,
} from './connect-orchestrator';

const sampleConfig = {
  userAddress: 'alice@example.com',
  token: 'tok-abc',
  href: 'https://example.com/storage/alice',
};

describe('startConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverStorage.mockResolvedValue({
      href: 'https://example.com/storage/alice',
      authUrl: 'https://example.com/oauth',
    });
  });

  it('requests permission for the WebFinger host before doing anything else', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn().mockResolvedValue(sampleConfig);

    await startConnect('alice@example.com', {
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(requestOriginPermission).toHaveBeenCalledWith('https://example.com');
  });

  it('fails without running discovery when the WebFinger host permission is declined', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(false);
    const connectViaOAuth = vi.fn();

    const result = await startConnect('alice@example.com', {
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(mockDiscoverStorage).not.toHaveBeenCalled();
    expect(connectViaOAuth).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
  });

  it('completes OAuth directly when the storage origin matches the WebFinger host', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn().mockResolvedValue(sampleConfig);

    const result = await startConnect('alice@example.com', {
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(requestOriginPermission).toHaveBeenCalledTimes(1);
    expect(connectViaOAuth).toHaveBeenCalledWith('alice@example.com');
    expect(result).toEqual({ status: 'connected', config: sampleConfig });
  });

  /**
   * The core regression guard: when the storage origin differs, startConnect
   * must NOT call requestOriginPermission for it — that call only happens
   * from a fresh click (continueConnectWithStoragePermission), never as part
   * of the async chain that already awaited the WebFinger fetch.
   */
  it('pauses with needs-storage-permission instead of requesting the storage origin itself', async () => {
    mockDiscoverStorage.mockResolvedValue({
      href: 'https://storage.example.com/storage/alice',
      authUrl: 'https://storage.example.com/oauth',
    });
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn();

    const result = await startConnect('alice@example.com', {
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(requestOriginPermission).toHaveBeenCalledTimes(1); // WebFinger host only
    expect(connectViaOAuth).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'needs-storage-permission',
      origin: 'https://storage.example.com',
    });
  });

  it('surfaces a discovery error as a clear message', async () => {
    mockDiscoverStorage.mockRejectedValue(new Error('WebFinger failed: 404'));
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn();

    const result = await startConnect('alice@example.com', {
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(result).toEqual({
      status: 'error',
      error: 'WebFinger failed: 404',
    });
  });

  it('surfaces a connectViaOAuth error as a clear message', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi
      .fn()
      .mockRejectedValue(new Error('OAuth error: access_denied'));

    const result = await startConnect('alice@example.com', {
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(result).toEqual({
      status: 'error',
      error: 'OAuth error: access_denied',
    });
  });

  it('trims the user address before deriving the WebFinger host and calling connectViaOAuth', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn().mockResolvedValue(sampleConfig);

    await startConnect('  alice@example.com  ', {
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(requestOriginPermission).toHaveBeenCalledWith('https://example.com');
    expect(connectViaOAuth).toHaveBeenCalledWith('alice@example.com');
  });

  it('uses http for a localhost WebFinger host', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn().mockResolvedValue(sampleConfig);
    mockDiscoverStorage.mockResolvedValue({
      href: 'http://localhost:8000/storage/alice',
      authUrl: 'http://localhost:8000/oauth',
    });

    await startConnect('alice@localhost:8000', {
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(requestOriginPermission).toHaveBeenCalledWith(
      'http://localhost:8000',
    );
  });
});

describe('continueConnectWithStoragePermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests permission for the given origin from this call (the fresh click)', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn().mockResolvedValue(sampleConfig);

    const result = await continueConnectWithStoragePermission(
      'alice@example.com',
      'https://storage.example.com',
      { requestOriginPermission, connectViaOAuth },
    );

    expect(requestOriginPermission).toHaveBeenCalledWith(
      'https://storage.example.com',
    );
    expect(connectViaOAuth).toHaveBeenCalledWith('alice@example.com');
    expect(result).toEqual({ status: 'connected', config: sampleConfig });
  });

  it('fails without calling connectViaOAuth when the storage origin permission is declined', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(false);
    const connectViaOAuth = vi.fn();

    const result = await continueConnectWithStoragePermission(
      'alice@example.com',
      'https://storage.example.com',
      { requestOriginPermission, connectViaOAuth },
    );

    expect(connectViaOAuth).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
  });

  it('surfaces a connectViaOAuth error as a clear message', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi
      .fn()
      .mockRejectedValue(new Error('OAuth error: invalid_client'));

    const result = await continueConnectWithStoragePermission(
      'alice@example.com',
      'https://storage.example.com',
      { requestOriginPermission, connectViaOAuth },
    );

    expect(result).toEqual({
      status: 'error',
      error: 'OAuth error: invalid_client',
    });
  });
});
