import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `background.ts` warns on load when the saved config's storage permission
 * has been revoked (the user can do this from Thunderbird's add-on manager
 * independently of this extension), so the user isn't left guessing why
 * saves silently stop working. These tests pin that behaviour down.
 */

const { mockGet, mockContains } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockContains: vi.fn(),
}));

vi.stubGlobal('browser', {
  storage: { local: { get: mockGet, set: vi.fn(), remove: vi.fn() } },
  permissions: { contains: mockContains },
});

describe('background script', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('warns when the saved config has no storage permission', async () => {
    mockGet.mockResolvedValue({
      'inbox-rs-config': {
        userAddress: 'alice@example.com',
        token: 'tok',
        href: 'https://storage.example.com/storage/alice',
      },
    });
    mockContains.mockResolvedValue(false);

    await import('./background');
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());

    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/permission/i);
  });

  it('does not warn when the permission is present', async () => {
    mockGet.mockResolvedValue({
      'inbox-rs-config': {
        userAddress: 'alice@example.com',
        token: 'tok',
        href: 'https://storage.example.com/storage/alice',
      },
    });
    mockContains.mockResolvedValue(true);

    await import('./background');
    await vi.waitFor(() => expect(mockContains).toHaveBeenCalled());

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn when there is no saved config yet', async () => {
    mockGet.mockResolvedValue({});

    await import('./background');
    await vi.waitFor(() => expect(mockGet).toHaveBeenCalled());

    expect(mockContains).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
