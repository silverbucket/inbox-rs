// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMac, modLabel } from './platform';

afterEach(() => {
  // restoreAllMocks does NOT reset vi.stubGlobal — clear the navigator stub
  // so it can't leak between tests.
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('platform', () => {
  it('detects mac via userAgentData.platform', () => {
    vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' } });
    expect(isMac()).toBe(true);
    expect(modLabel()).toBe('⌘');
  });

  it('falls back to navigator.platform', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(isMac()).toBe(true);
  });

  it('reports non-mac for Windows/Linux', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
    expect(isMac()).toBe(false);
    expect(modLabel()).toBe('Ctrl');
  });

  it('defaults to non-mac when platform is unknown', () => {
    vi.stubGlobal('navigator', {});
    expect(isMac()).toBe(false);
  });
});
