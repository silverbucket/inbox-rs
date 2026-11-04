import { describe, expect, it, vi } from 'vitest';
import { runConnect } from './connect-orchestrator';

/**
 * `<all_urls>` became an optional permission (see `manifest.test.ts`), so
 * the Options connect flow has to request host access itself. These tests
 * pin down the request order (WebFinger host, then the discovered storage
 * origin) and that a decline anywhere aborts the connect with a message
 * instead of hanging or silently losing the permission check.
 */

const sampleConfig = {
  userAddress: 'alice@example.com',
  token: 'tok-abc',
  href: 'https://storage.example.com/storage/alice',
};

describe('runConnect', () => {
  it('requests permission for the WebFinger host before connecting', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn().mockResolvedValue(sampleConfig);

    const result = await runConnect({
      userAddress: 'alice@example.com',
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(requestOriginPermission).toHaveBeenCalledWith('https://example.com');
    expect(connectViaOAuth).toHaveBeenCalledWith(
      'alice@example.com',
      expect.any(Function),
    );
    expect(result).toEqual({ ok: true, config: sampleConfig });
  });

  it('does not call connectViaOAuth when the WebFinger host permission is declined', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(false);
    const connectViaOAuth = vi.fn();

    const result = await runConnect({
      userAddress: 'alice@example.com',
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(connectViaOAuth).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/permission/i);
    }
  });

  it('requests permission for the discovered storage origin when it differs from the WebFinger host', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn(async (_userAddress, onDiscovered) => {
      await onDiscovered('https://storage.example.com');
      return sampleConfig;
    });

    await runConnect({
      userAddress: 'alice@example.com',
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(requestOriginPermission).toHaveBeenCalledWith('https://example.com');
    expect(requestOriginPermission).toHaveBeenCalledWith(
      'https://storage.example.com',
    );
    expect(requestOriginPermission).toHaveBeenCalledTimes(2);
  });

  it('does not re-request permission when the storage origin matches the WebFinger host', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn(async (_userAddress, onDiscovered) => {
      await onDiscovered('https://example.com');
      return sampleConfig;
    });

    await runConnect({
      userAddress: 'alice@example.com',
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(requestOriginPermission).toHaveBeenCalledTimes(1);
  });

  it('fails the connect when the storage origin permission is declined', async () => {
    const requestOriginPermission = vi
      .fn()
      .mockResolvedValueOnce(true) // WebFinger host granted
      .mockResolvedValueOnce(false); // storage origin declined
    const connectViaOAuth = vi.fn(async (_userAddress, onDiscovered) => {
      await onDiscovered('https://storage.example.com');
      return sampleConfig;
    });

    const result = await runConnect({
      userAddress: 'alice@example.com',
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/permission/i);
    }
  });

  it('surfaces a connectViaOAuth error as a clear message', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi
      .fn()
      .mockRejectedValue(new Error('WebFinger failed: 404'));

    const result = await runConnect({
      userAddress: 'alice@example.com',
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(result).toEqual({ ok: false, error: 'WebFinger failed: 404' });
  });

  it('trims the user address before deriving the WebFinger host', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn().mockResolvedValue(sampleConfig);

    await runConnect({
      userAddress: '  alice@example.com  ',
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(connectViaOAuth).toHaveBeenCalledWith(
      'alice@example.com',
      expect.any(Function),
    );
  });

  it('uses http for a localhost WebFinger host', async () => {
    const requestOriginPermission = vi.fn().mockResolvedValue(true);
    const connectViaOAuth = vi.fn().mockResolvedValue(sampleConfig);

    await runConnect({
      userAddress: 'alice@localhost:8000',
      requestOriginPermission,
      connectViaOAuth,
    });

    expect(requestOriginPermission).toHaveBeenCalledWith(
      'http://localhost:8000',
    );
  });
});
