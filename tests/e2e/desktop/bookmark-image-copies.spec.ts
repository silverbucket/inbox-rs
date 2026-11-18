/**
 * Local copies of preview images for links saved before copies were kept,
 * and the way back for someone who turned copies off.
 *
 * - Settings → Link previews → "Save images locally" downloads the image of
 *   every bookmark that still shows it from the original site, one download
 *   at a time, and reports what it could not save.
 * - The bookmark's card says when its image has no local copy, why a copy
 *   failed, and offers to save or retry. An image its site no longer has is
 *   remembered on the bookmark and never downloaded again.
 * - "Remove stored copies" (offered once copies are turned off) deletes the
 *   copies of images that are still linked from their site, and only those.
 *
 * Sockethub is mocked with `page.route`; service workers are blocked so the
 * routes see every request.
 */

import type { Page } from '@playwright/test';
import {
  getInboxItems,
  putInboxFile,
  putInboxItem,
} from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

const SOCKETHUB_GLOB = 'https://sockethub.silverbucket.net/**';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.use({ serviceWorkers: 'block' });

/** What the mocked media platform answers for one image URL. */
type Reply = 'ok' | 'not-found' | 'origin-refused';

/**
 * A Sockethub offering the `media` platform. Each `download` is answered
 * after a short delay, per `replies`, so overlapping downloads would show
 * in `most`: the highest number in flight at once.
 */
async function routeMedia(page: Page, replies: Record<string, Reply>) {
  const seen = { downloads: [] as string[], most: 0 };
  let inFlight = 0;
  await page.route(SOCKETHUB_GLOB, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'sockethub',
          apiVersion: 5,
          platforms: [
            { id: 'media', apiVersion: 1 },
            { id: 'metadata', apiVersion: 1 },
          ],
        }),
      });
    }
    const action = request.postDataJSON() as {
      type: string;
      object: { url: string };
    };
    if (action.type !== 'download') return route.abort();
    const image = action.object.url;
    seen.downloads.push(image);
    seen.most = Math.max(seen.most, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, 200));
    inFlight--;
    const reply = replies[image];
    const line =
      reply === 'ok'
        ? {
            ...action,
            object: {
              type: 'image',
              url: image,
              mediaType: 'image/png',
              size: PNG.byteLength,
              data: PNG.toString('base64'),
            },
          }
        : {
            ...action,
            error: `Error: image download failed (${reply}) for ${image}: HTTP ${reply === 'not-found' ? 404 : 403}`,
          };
    return route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: `${JSON.stringify(line)}\n`,
    });
  });
  return seen;
}

function olderBookmark(id: string, ogImage: string | undefined, extra = {}) {
  return {
    item: {
      id,
      type: 'bookmark' as const,
      title: `Saved link ${id}`,
      url: `https://example.com/${id}`,
      description: 'Saved before images were kept.',
      siteName: 'Example',
      ...(ogImage ? { ogImage } : {}),
      createdAt: new Date().toISOString(),
      ...extra,
    },
  };
}

function serverFile(username: string, token: string, path: string) {
  return fetch(`http://localhost:8000/storage/${username}/inbox/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function openLinkSettings(page: Page) {
  await page.keyboard.press('ControlOrMeta+,');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: /^Link previews/ }).click();
  return settings;
}

async function closeSettings(page: Page) {
  // Click the overlay: Escape only collapses the open section.
  await page.mouse.click(5, 5);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
}

async function openCard(page: Page, id: string) {
  await page.locator(`[data-item-id="${id}"] .card-select`).press('Enter');
  return page.getByRole('dialog');
}

test('older bookmarks get their image saved locally, one download at a time, and the cards explain what could not be saved', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const images = {
    fine: 'https://cdn.example.com/fine.png',
    gone: 'https://cdn.example.com/gone.png',
    refused: 'https://cdn.example.com/refused.png',
  };
  for (const [id, image] of Object.entries(images)) {
    await putInboxItem(freshRsUser, freshRsToken, olderBookmark(id, image));
  }
  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const page = await context.newPage();
  const replies: Record<string, Reply> = {
    [images.fine]: 'ok',
    [images.gone]: 'not-found',
    [images.refused]: 'origin-refused',
  };
  const seen = await routeMedia(page, replies);
  await page.route('https://cdn.example.com/**', (route) =>
    route.request().url() === images.gone
      ? route.fulfill({ status: 404, body: '' })
      : route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );

  await page.goto(webOrigin);
  await expect(page.locator('[data-item-id="fine"]')).toBeVisible({
    timeout: 15_000,
  });

  // Before anything is saved, the card says its image has no local copy.
  let dialog = await openCard(page, 'fine');
  await expect(dialog.getByText('Image not saved locally')).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Save a copy' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const settings = await openLinkSettings(page);
  await expect(
    settings.getByText('3 saved links still load their image'),
  ).toBeVisible();
  await settings.getByRole('button', { name: 'Save 3 images' }).click();

  await expect(
    page.getByText(
      'Saved 1 of 3 images — 1 gone from their site, 1 refused by their site',
    ),
  ).toBeVisible({ timeout: 15_000 });
  expect(seen.downloads.sort()).toEqual(Object.values(images).sort());
  expect(seen.most).toBe(1);
  // The saved and the gone one dropped out; the refused one can be retried.
  await expect(
    settings.getByRole('button', { name: 'Save 1 image' }),
  ).toBeEnabled();

  // On the server: the copy is stored, the dead image is marked.
  await expect
    .poll(async () => {
      const items = await getInboxItems(freshRsUser, freshRsToken);
      const byId = Object.fromEntries(items.map((item) => [item.id, item]));
      return [
        (byId.fine as { filePath?: string }).filePath,
        (byId.gone as { imageGone?: string }).imageGone,
        (byId.refused as { filePath?: string }).filePath,
      ];
    })
    .toEqual(['files/fine.png', images.gone, undefined]);
  const file = await serverFile(
    freshRsUser.username,
    freshRsToken,
    'files/fine.png',
  );
  expect(file.status).toBe(200);
  expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
  await closeSettings(page);

  // The saved card shows its own copy and no longer carries the marker.
  dialog = await openCard(page, 'fine');
  await expect(dialog.locator('img.view-image[src^="blob:"]')).toBeVisible();
  await expect(dialog.getByText('Image not saved locally')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // A dead image is final: said once, with nothing to retry.
  dialog = await openCard(page, 'gone');
  await expect(
    dialog.getByText('Image not saved locally: it is gone from its site.'),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Try again' })).toBeHidden();
  await expect(
    dialog.getByRole('button', { name: 'Save a copy' }),
  ).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // A refusal may pass: the card gives the reason and a retry that works.
  dialog = await openCard(page, 'refused');
  await expect(
    dialog.getByText('The image’s site refused the download.'),
  ).toBeVisible();
  replies[images.refused] = 'ok';
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.locator('img.view-image[src^="blob:"]')).toBeVisible();
  await expect(dialog.getByText('Image not saved locally')).toBeHidden();

  // The dead image was asked for once, ever.
  expect(seen.downloads.filter((url) => url === images.gone)).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Copies this device stored itself can be removed again too.
  const again = await openLinkSettings(page);
  await again
    .getByRole('button', { name: 'Keep a copy of preview images' })
    .click();
  await again.getByRole('button', { name: 'Remove 2 copies…' }).click();
  await again.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('Removed 2 stored copies')).toBeVisible({
    timeout: 15_000,
  });
  for (const path of ['files/fine.png', 'files/refused.png']) {
    await expect
      .poll(
        async () =>
          (await serverFile(freshRsUser.username, freshRsToken, path)).status,
      )
      .toBe(404);
  }
});

test('with copies turned off, stored copies can be removed after a confirmation, except a link’s only image', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const image = 'https://cdn.example.com/linked.png';
  for (const path of ['files/linked.png', 'files/only.png']) {
    await putInboxFile(freshRsUser, freshRsToken, {
      path,
      body: new Uint8Array(PNG),
      contentType: 'image/png',
    });
  }
  await putInboxItem(
    freshRsUser,
    freshRsToken,
    olderBookmark('linked', image, {
      filePath: 'files/linked.png',
      mimeType: 'image/png',
    }),
  );
  // No ogImage: the stored file is this bookmark's only image.
  await putInboxItem(
    freshRsUser,
    freshRsToken,
    olderBookmark('only', undefined, {
      filePath: 'files/only.png',
      mimeType: 'image/png',
    }),
  );
  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const page = await context.newPage();
  await routeMedia(page, {});
  await page.route(image, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );

  await page.goto(webOrigin);
  await expect(page.locator('[data-item-id="linked"]')).toBeVisible({
    timeout: 15_000,
  });

  const settings = await openLinkSettings(page);
  // While copies are kept there is nothing to remove, and nothing to save.
  await expect(settings.getByText('Remove stored copies')).toBeHidden();
  await expect(
    settings.getByText(
      'Every saved link that has an image keeps its own copy.',
    ),
  ).toBeVisible();

  await settings
    .getByRole('button', { name: 'Keep a copy of preview images' })
    .click();
  await expect(settings.getByText('Save images locally')).toBeHidden();
  await settings.getByRole('button', { name: 'Remove 1 copy…' }).click();
  await expect(settings.getByText('Remove 1 stored copy?')).toBeVisible();

  // Backing out removes nothing.
  await settings.getByRole('button', { name: 'Keep', exact: true }).click();
  expect(
    (await serverFile(freshRsUser.username, freshRsToken, 'files/linked.png'))
      .status,
  ).toBe(200);

  await settings.getByRole('button', { name: 'Remove 1 copy…' }).click();
  await settings.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('Removed 1 stored copy')).toBeVisible({
    timeout: 15_000,
  });
  await expect(settings.getByText('Remove stored copies')).toBeHidden();

  // On the server: the linked copy is gone and the bookmark no longer
  // points at it; the only-image bookmark is untouched.
  await expect
    .poll(
      async () =>
        (
          await serverFile(
            freshRsUser.username,
            freshRsToken,
            'files/linked.png',
          )
        ).status,
    )
    .toBe(404);
  await expect
    .poll(async () => {
      const items = await getInboxItems(freshRsUser, freshRsToken);
      const linked = items.find((item) => item.id === 'linked') as {
        filePath?: string;
        ogImage?: string;
      };
      return [linked.filePath, linked.ogImage];
    })
    .toEqual([undefined, image]);
  const items = await getInboxItems(freshRsUser, freshRsToken);
  expect(items.find((item) => item.id === 'only')).toMatchObject({
    filePath: 'files/only.png',
  });
  expect(
    (await serverFile(freshRsUser.username, freshRsToken, 'files/only.png'))
      .status,
  ).toBe(200);
  await closeSettings(page);

  // The card now shows the image from its site, with no "not saved" nag:
  // that is what turning copies off asked for.
  await expect(
    page.locator(`[data-item-id="linked"] img.og-image[src="${image}"]`),
  ).toBeVisible();
  const dialog = await openCard(page, 'linked');
  await expect(dialog.locator(`img.view-image[src="${image}"]`)).toBeVisible();
  await expect(dialog.getByText('Image not saved locally')).toBeHidden();
});
