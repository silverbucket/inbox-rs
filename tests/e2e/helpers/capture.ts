/**
 * Helpers for the Quick Capture PWA at `/capture/`.
 */

import type { BrowserContext } from '@playwright/test';

import { ARMADIETTO_ORIGIN, type RsUser } from './armadietto';

function captureConfigPayload(
  user: RsUser,
  token: string,
): Record<string, string> {
  const storageHref = `${ARMADIETTO_ORIGIN}/storage/${user.username}`;
  return {
    'inbox-rs-capture:config': JSON.stringify({
      userAddress: user.address,
      href: storageHref,
      storageApi: 'draft-dejong-remotestorage-10',
      token,
    }),
  };
}

export async function seedCaptureSession(
  context: BrowserContext,
  user: RsUser,
  token: string,
  _options: { clientOrigin: string },
): Promise<void> {
  const payload = captureConfigPayload(user, token);
  await context.addInitScript((entries) => {
    for (const [k, v] of Object.entries(entries)) {
      try {
        localStorage.setItem(k, v as string);
      } catch {
        // Storage quota or disabled.
      }
    }
  }, payload);
}

export async function clearCaptureStorage(
  context: BrowserContext,
): Promise<void> {
  await context.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('inbox-rs-capture:')) {
        localStorage.removeItem(key);
      }
    }
  });
}
