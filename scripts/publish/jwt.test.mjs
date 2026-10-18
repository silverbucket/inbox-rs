import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { versionUrl } from './atn.mjs';
import { hasVersion } from './chrome.mjs';
import {
  addonsServerToken,
  googleAssertion,
  signHs256,
  signRs256,
} from './jwt.mjs';

function decode(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

describe('signHs256', () => {
  it('matches the RFC 7519-style reference token from jwt.io', () => {
    const token = signHs256(
      { sub: '1234567890', name: 'John Doe', iat: 1516239022 },
      'your-256-bit-secret',
    );
    expect(token).toBe(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    );
  });

  it('uses base64url without padding', () => {
    const token = signHs256({ a: '??>>' }, 'k');
    expect(token).not.toMatch(/[+/=]/);
  });
});

describe('addonsServerToken', () => {
  it('carries iss, jti, iat and an exp within five minutes', () => {
    const [header, payload] = addonsServerToken(
      'user:123:45',
      'secret',
      1_700_000_000,
      'fixed-jti',
    ).split('.');
    expect(decode(header)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const claims = decode(payload);
    expect(claims).toMatchObject({
      iss: 'user:123:45',
      jti: 'fixed-jti',
      iat: 1_700_000_000,
    });
    expect(claims.exp - claims.iat).toBeGreaterThan(0);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(300);
  });

  it('mints a fresh jti per token', () => {
    const jti = (token) => decode(token.split('.')[1]).jti;
    expect(jti(addonsServerToken('i', 's'))).not.toBe(
      jti(addonsServerToken('i', 's')),
    );
  });
});

describe('RS256', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  function verifies(token) {
    const [header, payload, signature] = token.split('.');
    return createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature, 'base64url'));
  }

  it('produces a signature the public key verifies', () => {
    const token = signRs256({ hello: 'world' }, privateKey);
    expect(decode(token.split('.')[0])).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(verifies(token)).toBe(true);
    expect(verifies(token.replace(/\.[^.]+\./, '.e30.'))).toBe(false);
  });

  it('builds a Google service-account assertion', () => {
    const token = googleAssertion(
      {
        client_email: 'publisher@project.iam.gserviceaccount.com',
        private_key: privateKey,
      },
      'https://www.googleapis.com/auth/chromewebstore',
      1_700_000_000,
    );
    expect(verifies(token)).toBe(true);
    expect(decode(token.split('.')[1])).toEqual({
      iss: 'publisher@project.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/chromewebstore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
  });
});

describe('publish helpers', () => {
  it('detects a version already published or in review on Chrome', () => {
    const channel = (crxVersion) => ({
      distributionChannels: [{ crxVersion }],
    });
    expect(
      hasVersion({ publishedItemRevisionStatus: channel('2.7.0') }, '2.7.0'),
    ).toBe(true);
    expect(
      hasVersion({ submittedItemRevisionStatus: channel('2.7.0') }, '2.7.0'),
    ).toBe(true);
    expect(
      hasVersion({ publishedItemRevisionStatus: channel('2.6.4') }, '2.7.0'),
    ).toBe(false);
    expect(hasVersion({}, '2.7.0')).toBe(false);
  });

  it('targets the ATN version endpoint for the add-on ID', () => {
    expect(versionUrl('2.7.0')).toBe(
      'https://addons.thunderbird.net/api/v4/addons/inbox-rs@silverbucket.net/versions/2.7.0/',
    );
  });
});
