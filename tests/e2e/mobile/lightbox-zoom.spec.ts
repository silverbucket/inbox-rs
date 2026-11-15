/**
 * The app behaves like an installed app on a phone: the interface scrolls but
 * never zooms (`touch-action: pan-x pan-y` on the root, so no double-tap or
 * pinch zoom of the page). Images are the one thing people still need to look
 * closer at, so the lightbox does its own pinch, pan and double-tap zoom.
 *
 * Pinches are driven through CDP touch points, which only Chromium exposes;
 * the double-tap test runs on every mobile project.
 */

import { putInboxFile, putInboxItem, type RsUser } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

// 1×1 PNG; the lightbox stretches nothing, so give it a size via the test.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

type Page = import('@playwright/test').Page;

/** The lightbox image's on-screen scale (1 = unzoomed). */
async function zoom(page: Page): Promise<number> {
  return page
    .locator('.lightbox-img')
    .evaluate(
      (el: HTMLElement) => el.getBoundingClientRect().width / el.offsetWidth,
    );
}

async function openLightbox(
  page: Page,
  context: import('@playwright/test').BrowserContext,
  user: RsUser,
  token: string,
  webOrigin: string,
) {
  const id = 'e2e-zoom-image-1';
  await putInboxItem(user, token, {
    item: {
      id,
      type: 'image',
      title: 'Zoomable photo',
      filePath: `files/${id}.png`,
      mimeType: 'image/png',
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  });
  await putInboxFile(user, token, {
    path: `files/${id}.png`,
    body: PNG_1x1,
    contentType: 'image/png',
  });
  await seedRsSession(context, user, token, { clientOrigin: webOrigin });
  await page.goto('/');
  // The way a phone user gets there: open the card, then tap its image.
  const card = page.getByRole('button', { name: 'Open Zoomable photo' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.tap();
  const photo = page.locator('.view-image');
  await expect(photo).toBeVisible({ timeout: 20_000 });
  await photo.tap();
  const img = page.locator('.lightbox-img');
  await expect(img).toBeVisible();
  // A 1px image is too small to pinch; size it like a real photo.
  await img.evaluate((el: HTMLElement) => {
    el.style.width = '300px';
    el.style.height = '200px';
  });
  return img;
}

test('the page itself only scrolls: no double-tap or pinch zoom', async ({
  page,
}) => {
  await page.goto('/');
  // The stylesheet arrives with the app bundle, after the document loads.
  await expect
    .poll(() =>
      page.evaluate(
        () => getComputedStyle(document.documentElement).touchAction,
      ),
    )
    .toBe('pan-x pan-y');
});

test('double-tapping the lightbox image zooms in, and again zooms out', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const page = await context.newPage();
  const img = await openLightbox(
    page,
    context,
    freshRsUser,
    freshRsToken,
    webOrigin,
  );
  expect(await zoom(page)).toBeCloseTo(1, 1);

  const box = await img.boundingBox();
  if (!box) throw new Error('lightbox image has no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.touchscreen.tap(x, y);
  await page.touchscreen.tap(x, y);
  await expect.poll(() => zoom(page)).toBeCloseTo(2.5, 1);
  await expect(img).toBeVisible(); // a double-tap must not close the lightbox

  await page.touchscreen.tap(x, y);
  await page.touchscreen.tap(x, y);
  await expect.poll(() => zoom(page)).toBeCloseTo(1, 1);
});

test('pinching zooms the lightbox image, a drag pans it, and it stays open', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'multi-touch needs CDP');
  const page = await context.newPage();
  const img = await openLightbox(
    page,
    context,
    freshRsUser,
    freshRsToken,
    webOrigin,
  );
  const box = await img.boundingBox();
  if (!box) throw new Error('lightbox image has no box');
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);

  const cdp = await context.newCDPSession(page);
  const touch = (type: string, spread: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart',
      touchPoints:
        type === 'touchEnd'
          ? []
          : [
              { x: cx - spread, y: cy, id: 0 },
              { x: cx + spread, y: cy, id: 1 },
            ],
    });

  await touch('touchStart', 30);
  for (const spread of [45, 60, 75, 90]) await touch('touchMove', spread);
  // Mid-gesture: the image already follows the fingers (30px → 90px = 3×).
  await expect.poll(() => zoom(page)).toBeCloseTo(3, 0);
  await touch('touchEnd', 0);

  await expect(img).toBeVisible();
  await expect.poll(() => zoom(page)).toBeCloseTo(3, 0);

  // One finger drags the zoomed image, and letting go leaves the lightbox open.
  const drag = (type: string, x: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart',
      touchPoints: type === 'touchEnd' ? [] : [{ x, y: cy, id: 0 }],
    });
  const left = async () => (await img.boundingBox())?.x ?? 0;
  const before = await left();
  await drag('touchStart', cx);
  for (const x of [cx + 20, cx + 40, cx + 60]) await drag('touchMove', x);
  await expect.poll(async () => (await left()) - before).toBeGreaterThan(30);
  await drag('touchEnd', 0);
  await expect(img).toBeVisible();
  await expect.poll(() => zoom(page)).toBeCloseTo(3, 0);

  // Pinching back in never shrinks the image below its fitted size.
  await touch('touchStart', 90);
  for (const spread of [50, 20, 8]) await touch('touchMove', spread);
  await touch('touchEnd', 0);
  await expect.poll(() => zoom(page)).toBeCloseTo(1, 1);
});
