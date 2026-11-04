import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockContains, mockRequest } = vi.hoisted(() => ({
  mockContains:
    vi.fn<(permissions: { origins: string[] }) => Promise<boolean>>(),
  mockRequest:
    vi.fn<(permissions: { origins: string[] }) => Promise<boolean>>(),
}));

vi.stubGlobal('browser', {
  permissions: { contains: mockContains, request: mockRequest },
});

import {
  hasStorageOriginPermission,
  matchPatternForOrigin,
  requestOriginPermission,
} from './permissions';

describe('matchPatternForOrigin', () => {
  it('builds a scheme + host wildcard pattern', () => {
    expect(matchPatternForOrigin('https://storage.example.com')).toBe(
      'https://storage.example.com/*',
    );
  });

  /**
   * REGRESSION: Gecko match patterns have no port component (MDN "Match
   * patterns") — a pattern like `http://localhost:8000/*` is invalid, which
   * breaks the local Armadietto dev server (and any other non-default-port
   * host) every time a permission is requested or checked.
   */
  it('drops the port — Gecko match patterns cannot include one', () => {
    expect(matchPatternForOrigin('http://localhost:8000')).toBe(
      'http://localhost/*',
    );
  });
});

describe('hasStorageOriginPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false without checking when there is no config', async () => {
    expect(await hasStorageOriginPermission(null)).toBe(false);
    expect(await hasStorageOriginPermission(undefined)).toBe(false);
    expect(mockContains).not.toHaveBeenCalled();
  });

  it('returns false without checking when the config has no href', async () => {
    expect(await hasStorageOriginPermission({})).toBe(false);
    expect(mockContains).not.toHaveBeenCalled();
  });

  it('checks browser.permissions.contains for the href origin', async () => {
    mockContains.mockResolvedValue(true);

    const granted = await hasStorageOriginPermission({
      href: 'https://storage.example.com/storage/alice',
    });

    expect(granted).toBe(true);
    expect(mockContains).toHaveBeenCalledWith({
      origins: ['https://storage.example.com/*'],
    });
  });

  it('returns false when the permission is missing', async () => {
    mockContains.mockResolvedValue(false);

    const granted = await hasStorageOriginPermission({
      href: 'https://storage.example.com/storage/alice',
    });

    expect(granted).toBe(false);
  });

  it('checks a port-free pattern for a localhost href', async () => {
    mockContains.mockResolvedValue(true);

    await hasStorageOriginPermission({
      href: 'http://localhost:8000/storage/alice',
    });

    expect(mockContains).toHaveBeenCalledWith({
      origins: ['http://localhost/*'],
    });
  });
});

describe('requestOriginPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests a port-free match pattern for the given origin', async () => {
    mockRequest.mockResolvedValue(true);

    const granted = await requestOriginPermission('http://localhost:8000');

    expect(granted).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith({
      origins: ['http://localhost/*'],
    });
  });

  it('returns false when the request is declined', async () => {
    mockRequest.mockResolvedValue(false);

    expect(await requestOriginPermission('https://storage.example.com')).toBe(
      false,
    );
  });
});
