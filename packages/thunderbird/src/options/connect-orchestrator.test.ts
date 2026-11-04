import { describe, expect, it, vi } from 'vitest';
import { runConnect } from './connect-orchestrator';

/**
 * `<all_urls>` became an optional permission (see `manifest.test.ts`), so
 * the Options connect flow has to request it itself. Gecko only honours
 * `browser.permissions.request()` when it's called synchronously from a
 * user input handler — a handler that has already awaited a promise no
 * longer counts, and the request is silently refused. These tests pin
 * down that `runConnect` requests `<all_urls>` exactly once, with no
 * `await` ahead of that call, so it always runs inside the click that
 * invoked `connect()`.
 */

const sampleConfig = {
  userAddress: 'alice@example.com',
  token: 'tok-abc',
  href: 'https://storage.example.com/storage/alice',
};

describe('runConnect', () => {
  it('requests <all_urls> exactly once', async () => {
    const requestAllUrlsPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn().mockResolvedValue(sampleConfig);

    await runConnect('alice@example.com', {
      requestAllUrlsPermission,
      connectViaOAuth,
    });

    expect(requestAllUrlsPermission).toHaveBeenCalledTimes(1);
    expect(requestAllUrlsPermission).toHaveBeenCalledWith();
  });

  /**
   * The core regression guard: the permission request must happen
   * synchronously, with no `await` ahead of it, or Gecko refuses it as not
   * coming from a user input handler. Checking the mock call count in the
   * same tick — before awaiting the `runConnect` promise at all — proves
   * the call happened inside `runConnect`'s synchronous prologue.
   */
  it('requests <all_urls> before any await', () => {
    const requestAllUrlsPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn().mockResolvedValue(sampleConfig);

    const promise = runConnect('alice@example.com', {
      requestAllUrlsPermission,
      connectViaOAuth,
    });

    expect(requestAllUrlsPermission).toHaveBeenCalledTimes(1);
    return promise;
  });

  it('connects when the permission is granted', async () => {
    const requestAllUrlsPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn().mockResolvedValue(sampleConfig);

    const result = await runConnect('alice@example.com', {
      requestAllUrlsPermission,
      connectViaOAuth,
    });

    expect(connectViaOAuth).toHaveBeenCalledWith('alice@example.com');
    expect(result).toEqual({ ok: true, config: sampleConfig });
  });

  it('fails without calling connectViaOAuth when the permission is declined, and keeps the message', async () => {
    const requestAllUrlsPermission = vi.fn().mockResolvedValue(false);
    const connectViaOAuth = vi.fn();

    const result = await runConnect('alice@example.com', {
      requestAllUrlsPermission,
      connectViaOAuth,
    });

    expect(connectViaOAuth).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/permission/i);
    }
  });

  it('surfaces a connectViaOAuth error as a clear message', async () => {
    const requestAllUrlsPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi
      .fn()
      .mockRejectedValue(new Error('WebFinger failed: 404'));

    const result = await runConnect('alice@example.com', {
      requestAllUrlsPermission,
      connectViaOAuth,
    });

    expect(result).toEqual({ ok: false, error: 'WebFinger failed: 404' });
  });

  it('trims the user address before calling connectViaOAuth', async () => {
    const requestAllUrlsPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn().mockResolvedValue(sampleConfig);

    await runConnect('  alice@example.com  ', {
      requestAllUrlsPermission,
      connectViaOAuth,
    });

    expect(connectViaOAuth).toHaveBeenCalledWith('alice@example.com');
  });
});
