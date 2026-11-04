import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockContains } = vi.hoisted(() => ({
  mockContains:
    vi.fn<(permissions: { origins: string[] }) => Promise<boolean>>(),
}));

vi.stubGlobal('browser', {
  permissions: { contains: mockContains },
});

import { hasStorageOriginPermission } from './permissions';

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
});
