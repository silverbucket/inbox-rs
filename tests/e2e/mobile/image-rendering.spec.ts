/**
 * Cross-device image rendering (issue: "on mobile I don't see my images").
 *
 * The reported symptom: an image captured on the desktop shows there, but the
 * card is blank on the phone even though the phone is connected and the card
 * is correctly typed as an image with its title.
 *
 * Root-cause shape this spec pins down:
 *
 * - Item metadata lives under `/inbox/items/` (cached `ALL`) and syncs to
 *   every device, so the phone always has the title + type.
 * - Image *bytes* live under `/inbox/files/` (cached `SEEN`) and are never
 *   proactively pushed to a new device. The capturing device keeps them in
 *   its own IndexedDB, so it renders regardless of whether the upload ever
 *   reached the server. Only a fresh device fetches the bytes over
 *   authenticated HTTP (`fetchFileWithAuth`) — so only a fresh device tests
 *   that path.
 *
 * We therefore stage the image entirely on the *server* (metadata + bytes,
 * never through the UI) and load it in a brand-new browser context. That
 * context is, for all purposes that matter here, the phone: connected, with
 * the item metadata, but an empty file cache.
 *
 * Runs under both mobile projects — `mobile-chromium` (Pixel 5) and
 * `mobile-webkit` (iPhone / Safari engine), the closest automatable proxy for
 * real iOS Safari.
 */

import { putInboxFile, putInboxItem } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

// Standard 1×1 transparent PNG (67 bytes). A real decodable image, so a
// painted <img> reports naturalWidth ≥ 1 while a blank card reports 0.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Poll the first grid image's decoded width; 0 means "never painted". */
async function paintedWidth(page: import('@playwright/test').Page) {
  const img = page.locator('.image-card img');
  if ((await img.count()) === 0) return 0;
  return img
    .first()
    .evaluate((el: HTMLImageElement) => el.naturalWidth)
    .catch(() => 0);
}

test('a fresh device renders an image that exists only on the server', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const id = 'e2e-plain-image-1';

  // Stage the image on the server exactly as a *different* device's capture
  // would have left it: metadata + full bytes, no thumbnail (mirrors the
  // pre-thumbnail images that the bug report says are also blank).
  await putInboxItem(freshRsUser, freshRsToken, {
    item: {
      id,
      type: 'image',
      title: 'Server-only photo',
      filePath: `files/${id}.png`,
      mimeType: 'image/png',
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  });
  await putInboxFile(freshRsUser, freshRsToken, {
    path: `files/${id}.png`,
    body: PNG_1x1,
    contentType: 'image/png',
  });

  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const page = await context.newPage();

  // Record what the device's authenticated file GET actually returns — this
  // is the single fact that diagnoses a blank card (404 vs 401/403 vs blocked
  // vs a 200 that still doesn't paint).
  const fileResponses: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/inbox/files/')) {
      fileResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });
  page.on('requestfailed', (r) => {
    if (r.url().includes('/inbox/files/')) {
      fileResponses.push(`FAILED ${r.failure()?.errorText ?? '?'} ${r.url()}`);
    }
  });

  await page.goto(webOrigin);

  // The card renders from synced metadata first (title + image type). If this
  // never appears, the failure is sync, not image loading — a different bug.
  await expect(page.locator('.image-card')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Server-only photo')).toBeVisible();

  // The actual assertion: the bytes fetched from the server paint.
  await expect
    .poll(() => paintedWidth(page), {
      timeout: 15_000,
      message:
        'image bytes never painted on a fresh device — file GETs seen: ' +
        JSON.stringify(fileResponses),
    })
    .toBeGreaterThan(0);

  // And the "Not connected" placeholder must be gone.
  await expect(page.getByText('Not connected')).toHaveCount(0);
});

test('a thumbnailed image still renders when only the thumbnail is missing on the server', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const id = 'e2e-thumb-missing-1';

  // Item advertises a thumbPath, and the full image is on the server, but the
  // thumbnail bytes never made it (best-effort upload, cross-client capture,
  // etc.). The grid prefers `thumbPath`; if it can't fall back to the full
  // image when the thumb 404s, the card is blank on every fresh device.
  await putInboxItem(freshRsUser, freshRsToken, {
    item: {
      id,
      type: 'image',
      title: 'Thumb-missing photo',
      filePath: `files/${id}.png`,
      mimeType: 'image/png',
      thumbPath: `files/${id}.thumb.jpg`,
      thumbMimeType: 'image/jpeg',
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  });
  await putInboxFile(freshRsUser, freshRsToken, {
    path: `files/${id}.png`,
    body: PNG_1x1,
    contentType: 'image/png',
  });
  // Deliberately do NOT put files/<id>.thumb.jpg.

  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const page = await context.newPage();
  await page.goto(webOrigin);

  await expect(page.locator('.image-card')).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => paintedWidth(page), {
      timeout: 15_000,
      message: 'card blank: grid did not fall back to the full image',
    })
    .toBeGreaterThan(0);
});
