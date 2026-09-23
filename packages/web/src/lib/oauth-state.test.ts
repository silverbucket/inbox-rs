// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginOAuthAuthorization, guardOAuthCallback } from './oauth-state';

const key = 'inbox-rs:pending-oauth';

describe('OAuth callback state validation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => vi.restoreAllMocks());

  it('starts authorization when randomUUID is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });
    try {
      const state = beginOAuthAuthorization('/todos');
      expect(state).toMatch(/^[0-9a-f]{32}$/);
      expect(JSON.parse(sessionStorage.getItem(key) ?? '{}').state).toBe(state);
    } finally {
      if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor);
      else Reflect.deleteProperty(crypto, 'randomUUID');
    }
  });

  it.each([
    '?error=access_denied',
    '#error=access_denied',
    '#/search?q=notes&error=access_denied',
    '?error=server_error',
  ])('strips an unsolicited error from %s', (url) => {
    window.history.replaceState(null, '', `/${url}`);
    guardOAuthCallback();
    expect(window.location.href).not.toContain('error=');
    if (url.startsWith('#/search'))
      expect(window.location.hash).toBe('#/search?q=notes');
  });

  it('keeps unrelated query parameters and rejects forged token callbacks too', () => {
    window.history.replaceState(
      null,
      '',
      '/?view=compact&access_token=forged&state=wrong#access_token=also-forged',
    );
    guardOAuthCallback();
    expect(window.location.search).toBe('?view=compact');
    expect(window.location.hash).toBe('');
  });

  it.each([
    '?code=forged-auth-code&state=wrong',
    '#code=forged-auth-code',
    '?rsDiscovery=forged',
    '?remotestorage=attacker%40evil.example',
    '#remotestorage=attacker%40evil.example',
  ])('strips an unsolicited OAuth callback from %s', (url) => {
    window.history.replaceState(null, '', `/${url}`);
    guardOAuthCallback();
    expect(window.location.href).not.toMatch(
      /code=|rsDiscovery=|remotestorage=/,
    );
  });

  it.each(['?', '#'])('accepts a matching denial from %s once', (delimiter) => {
    const state = beginOAuthAuthorization('/todos');
    window.history.replaceState(
      null,
      '',
      `/${delimiter}error=access_denied&state=${state}`,
    );
    guardOAuthCallback();
    expect(window.location.href).toContain('error=access_denied');
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(
      new URLSearchParams(window.location.hash.slice(1)).get('state'),
    ).toBe('/todos');
    guardOAuthCallback();
    expect(window.location.href).not.toContain('error=');
  });

  it('preserves the pending attempt when an unrelated callback has wrong state', () => {
    const state = beginOAuthAuthorization('/todos');
    window.history.replaceState(null, '', '/#error=access_denied&state=wrong');
    guardOAuthCallback();
    expect(window.location.hash).toBe('');
    expect(JSON.parse(sessionStorage.getItem(key) ?? '{}').state).toBe(state);
  });

  it('rejects missing state even with a pending attempt', () => {
    beginOAuthAuthorization('');
    window.history.replaceState(null, '', '/#error=access_denied');
    guardOAuthCallback();
    expect(window.location.hash).toBe('');
  });

  it('rejects expired and future-dated attempts', () => {
    for (const elapsed of [16 * 60 * 1000, -60_000]) {
      const state = beginOAuthAuthorization('');
      const pending = JSON.parse(sessionStorage.getItem(key) ?? '{}');
      pending.createdAt = Date.now() - elapsed;
      sessionStorage.setItem(key, JSON.stringify(pending));
      window.history.replaceState(
        null,
        '',
        `/#error=access_denied&state=${state}`,
      );
      guardOAuthCallback();
      expect(window.location.hash).toBe('');
    }
  });

  it('accepts a matching token and restores the app route instead of the nonce', () => {
    const state = beginOAuthAuthorization('/collection/abc');
    window.history.replaceState(
      null,
      '',
      `/#access_token=valid-token&state=${state}`,
    );
    guardOAuthCallback();
    const params = new URLSearchParams(window.location.hash.slice(1));
    expect(params.get('access_token')).toBe('valid-token');
    expect(params.get('state')).toBe('/collection/abc');
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('accepts a matching authorization code and restores the app route', () => {
    const state = beginOAuthAuthorization('/inbox');
    window.history.replaceState(null, '', `/?code=valid-code&state=${state}`);
    guardOAuthCallback();
    expect(window.location.search).toContain('code=valid-code');
    expect(window.location.search).not.toContain(state);
    expect(
      new URLSearchParams(window.location.hash.slice(1)).get('state'),
    ).toBe('/inbox');
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('fails closed when pending state is corrupt or storage is unavailable', () => {
    sessionStorage.setItem(key, '{broken');
    window.history.replaceState(null, '', '/?error=access_denied');
    guardOAuthCallback();
    expect(window.location.search).toBe('');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    window.history.replaceState(null, '', '/#error=access_denied');
    guardOAuthCallback();
    expect(window.location.hash).toBe('');
  });

  it('rejects a callback when its nonce cannot be consumed', () => {
    const state = beginOAuthAuthorization('');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    window.history.replaceState(
      null,
      '',
      `/#error=access_denied&state=${state}`,
    );
    guardOAuthCallback();
    expect(window.location.hash).toBe('');
  });

  it('does not initiate an attempt when the nonce cannot be stored', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    expect(() => beginOAuthAuthorization('')).toThrow('Storage unavailable');
  });

  it('leaves ordinary navigation untouched', () => {
    window.history.replaceState(
      null,
      '',
      '/?view=compact#/search?q=notes&tag=work',
    );
    const original = window.location.href;
    guardOAuthCallback();
    expect(window.location.href).toBe(original);
  });
});
