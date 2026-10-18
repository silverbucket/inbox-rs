/**
 * Minimal JWT signing for the store publish scripts, using node:crypto only.
 *
 * - HS256: addons.thunderbird.net (and AMO) API keys — `Authorization: JWT <token>`.
 * - RS256: Google service-account assertions exchanged for an OAuth token.
 */

import { createHmac, createSign, randomUUID } from 'node:crypto';

export function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signingInput(header, payload) {
  return `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
}

export function signHs256(payload, secret) {
  const input = signingInput({ alg: 'HS256', typ: 'JWT' }, payload);
  const signature = createHmac('sha256', secret).update(input).digest();
  return `${input}.${base64url(signature)}`;
}

export function signRs256(payload, privateKeyPem) {
  const input = signingInput({ alg: 'RS256', typ: 'JWT' }, payload);
  const signature = createSign('RSA-SHA256').update(input).sign(privateKeyPem);
  return `${input}.${base64url(signature)}`;
}

/**
 * A single-use addons-server API token. The server rejects reuse (jti) and
 * lifetimes over five minutes, so callers mint one per request.
 */
export function addonsServerToken(
  issuer,
  secret,
  now = Math.floor(Date.now() / 1000),
  jti = randomUUID(),
) {
  return signHs256({ iss: issuer, jti, iat: now, exp: now + 60 }, secret);
}

/** Google OAuth JWT-bearer assertion for a service-account key file. */
export function googleAssertion(
  serviceAccount,
  scope,
  now = Math.floor(Date.now() / 1000),
) {
  return signRs256(
    {
      iss: serviceAccount.client_email,
      scope,
      aud: serviceAccount.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    serviceAccount.private_key,
  );
}
