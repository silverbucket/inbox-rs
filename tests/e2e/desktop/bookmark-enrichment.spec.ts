/**
 * Bookmark metadata enrichment via the Sockethub HTTP actions endpoint.
 *
 * Capturing a URL stores the bookmark immediately, then fills its blank
 * title/description/preview image from the page's Open Graph metadata in
 * the background. The Sockethub endpoint is mocked with `page.route` so
 * the suite stays hermetic — both the NDJSON happy path and the
 * server-error path are exercised, plus the manual "Fetch preview"
 * fallback in the view card.
 *
 * Service workers are blocked in this spec: Playwright route interception
 * can't see requests once a service worker handles them, and enrichment
 * behaviour doesn't depend on the SW.
 *
 * Each test runs as a per-test fresh user rather than the shared worker
 * user, so the bookmarks it creates don't leak into the starting state of
 * later specs in the worker.
 */

import type { Page } from '@playwright/test';
import {
  getInboxItems,
  putInboxFile,
  putInboxItem,
} from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import {
  assertNoConsoleErrors,
  attachConsoleCapture,
  seedRsSession,
} from '../helpers/pwa';

const SOCKETHUB_GLOB = 'https://sockethub.silverbucket.net/**';

function ndjson(lines: unknown[]): {
  status: number;
  contentType: string;
  body: string;
} {
  return {
    status: 200,
    contentType: 'application/x-ndjson',
    body: `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
  };
}

function metadataResult(url: string, object: Record<string, unknown>) {
  return ndjson([
    { type: 'fetch', actor: { id: url, type: 'website' }, object },
  ]);
}

test.use({ serviceWorkers: 'block' });

type FreshPageArgs = {
  context: Parameters<typeof seedRsSession>[0];
  freshRsUser: Parameters<typeof seedRsSession>[1];
  freshRsToken: string;
  webOrigin: string;
};

/** Open a page connected as this test's own empty user. */
async function freshConnectedPage({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}: FreshPageArgs): Promise<Page> {
  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  return context.newPage();
}

test('a captured link is enriched with fetched title, description and image', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const connectedPage = await freshConnectedPage({
    context,
    freshRsUser,
    freshRsToken,
    webOrigin,
  });
  const log = attachConsoleCapture(connectedPage);
  const url = 'https://example.com';
  await connectedPage.route(SOCKETHUB_GLOB, (route) =>
    route.fulfill(
      // Mirrors the live server's response shape: object type `page`,
      // site name in `name`, image as an array of media descriptors.
      metadataResult(url, {
        type: 'page',
        title: 'Example Domain',
        name: 'Example',
        description: 'An illustrative example page',
        image: [{ url: 'https://example.com/og.png', width: '1200' }],
        favicon: 'https://example.com/site-icon.png',
        url,
      }),
    ),
  );
  // Serve real image bytes for the og:image and favicon URLs — the card
  // hides broken images via `onerror`, so the visibility assertions need
  // loadable sources.
  for (const mediaUrl of [
    'https://example.com/og.png',
    'https://example.com/site-icon.png',
  ]) {
    await connectedPage.route(mediaUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      }),
    );
  }

  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');
  await connectedPage
    .getByRole('button', { name: 'Inbox', exact: true })
    .first()
    .click();

  const input = connectedPage.getByPlaceholder(
    'Paste a link, jot a note, or drop a file…',
  );
  await input.click();
  await input.fill(url);
  await input.press('Enter');

  // The card appears immediately (title falls back to the URL), then the
  // background fetch fills the metadata and the card re-renders.
  await expect(
    connectedPage.getByRole('link', { name: 'Example Domain' }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    connectedPage.getByText('An illustrative example page'),
  ).toBeVisible();
  await expect(
    connectedPage.locator('img[src="https://example.com/og.png"]'),
  ).toBeVisible();
  // The fetched favicon decorates the card's kind icon in place of the
  // generic bookmark glyph.
  await expect(
    connectedPage.locator(
      'img.kind-favicon[src="https://example.com/site-icon.png"]',
    ),
  ).toBeVisible();

  assertNoConsoleErrors(log);
});

test('a failed metadata fetch leaves the capture intact and the view card offers a manual fetch', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const connectedPage = await freshConnectedPage({
    context,
    freshRsUser,
    freshRsToken,
    webOrigin,
  });
  const log = attachConsoleCapture(connectedPage);
  const url = 'https://example.org';
  // The server reports it couldn't fetch the page (an in-band NDJSON error,
  // as Sockethub sends for dead links or scrape failures).
  await connectedPage.route(SOCKETHUB_GLOB, (route) =>
    route.fulfill(ndjson([{ type: 'error', error: 'could not fetch page' }])),
  );

  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');
  await connectedPage
    .getByRole('button', { name: 'Inbox', exact: true })
    .first()
    .click();

  const input = connectedPage.getByPlaceholder(
    'Paste a link, jot a note, or drop a file…',
  );
  await input.click();
  await input.fill(url);
  const failedFetch = connectedPage.waitForResponse(SOCKETHUB_GLOB);
  await input.press('Enter');

  // The bookmark still saves, titled by its URL.
  const cardLink = connectedPage.getByRole('link', { name: url });
  await expect(cardLink).toBeVisible({ timeout: 10_000 });
  // Let the doomed background fetch settle before swapping the mock.
  await failedFetch;

  // Now the server works again — recover through the view card's button.
  await connectedPage.unroute(SOCKETHUB_GLOB);
  await connectedPage.route(SOCKETHUB_GLOB, (route) =>
    route.fulfill(
      metadataResult(url, {
        type: 'page',
        title: 'Example Org',
        description: 'Recovered metadata',
        url,
      }),
    ),
  );

  // Open the view modal with keyboard activation. A mouse click aims at
  // the card's centre, which can land on the inner title link (a click
  // the card handler deliberately ignores) depending on font metrics —
  // that's exactly what happened on CI. Enter always hits the handler.
  // A string name substring-matches, so the URL's dots stay literal
  // (new RegExp(url) would treat them as metacharacters).
  await connectedPage.getByRole('button', { name: url }).first().press('Enter');
  const dialog = connectedPage.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  await dialog.getByRole('button', { name: 'Fetch preview' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Example Org',
    { timeout: 10_000 },
  );
  await expect(
    dialog.getByRole('textbox', { name: 'Description' }),
  ).toHaveValue('Recovered metadata');

  assertNoConsoleErrors(log);
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('a complete preview can be re-fetched, and a different image is only used when chosen', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const url = 'https://example.net/post/1';
  const saved = 'https://example.net/generic-card.png';
  const fresh = 'https://example.net/real-photo.png';
  // Nothing is missing here, so before this feature the card offered no
  // way to fetch again.
  await putInboxItem(freshRsUser, freshRsToken, {
    item: {
      id: 'wrong-image',
      type: 'bookmark',
      title: 'A post worth keeping',
      url,
      description: 'Saved with the site’s generic card.',
      siteName: 'Example',
      ogImage: saved,
      createdAt: new Date().toISOString(),
    },
  });
  const page = await freshConnectedPage({
    context,
    freshRsUser,
    freshRsToken,
    webOrigin,
  });
  const log = attachConsoleCapture(page);
  await page.route(SOCKETHUB_GLOB, (route) =>
    route.fulfill(
      metadataResult(url, {
        type: 'page',
        title: 'The page’s own title',
        description: 'The page’s own description',
        image: [{ url: fresh }],
        url,
      }),
    ),
  );
  for (const mediaUrl of [saved, fresh]) {
    await page.route(mediaUrl, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
    );
  }

  await page.goto(webOrigin);
  await page
    .locator('[data-item-id="wrong-image"] .card-select')
    .press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  // Declining keeps everything as it was saved.
  await dialog.getByRole('button', { name: 'Refresh preview' }).click();
  const choice = dialog.getByRole('group', {
    name: 'Choose the preview image',
  });
  await expect(choice.locator(`img[src="${saved}"]`)).toBeVisible();
  await expect(choice.locator(`img[src="${fresh}"]`)).toBeVisible();
  await choice.getByRole('button', { name: 'Keep saved image' }).click();
  await expect(choice).toBeHidden();
  await expect(dialog.locator(`img.view-image[src="${saved}"]`)).toBeVisible();
  // Text the user already has is never replaced by a re-fetch.
  await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'A post worth keeping',
  );

  // Accepting swaps the image, and only the image.
  await dialog.getByRole('button', { name: 'Refresh preview' }).click();
  await choice.getByRole('button', { name: 'Use new image' }).click();
  await expect(dialog.locator(`img.view-image[src="${fresh}"]`)).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'A post worth keeping',
  );

  // The page now agrees with what is saved: nothing left to offer.
  await dialog.getByRole('button', { name: 'Refresh preview' }).click();
  await expect(dialog.getByText('Preview is up to date')).toBeVisible();
  // The answer does not take the button away.
  await expect(
    dialog.getByRole('button', { name: 'Refresh preview' }),
  ).toBeVisible();

  assertNoConsoleErrors(log);
});

test('a card whose saved image is dead shows the replacement as soon as it is chosen', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const url = 'https://example.net/post/2';
  const dead = 'https://example.net/gone.png';
  const fresh = 'https://example.net/real-photo.png';
  await putInboxItem(freshRsUser, freshRsToken, {
    item: {
      id: 'dead-image',
      type: 'bookmark',
      title: 'A post whose card image went away',
      url,
      description: 'Saved while the image still existed.',
      siteName: 'Example',
      ogImage: dead,
      createdAt: new Date().toISOString(),
    },
  });
  const page = await freshConnectedPage({
    context,
    freshRsUser,
    freshRsToken,
    webOrigin,
  });
  await page.route(SOCKETHUB_GLOB, (route) =>
    route.fulfill(
      metadataResult(url, {
        type: 'page',
        title: 'The page’s own title',
        image: [{ url: fresh }],
        url,
      }),
    ),
  );
  await page.route(dead, (route) => route.abort());
  await page.route(fresh, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );

  await page.goto(webOrigin);
  const card = page.locator('[data-item-id="dead-image"]');
  await expect(card).toBeVisible({ timeout: 10_000 });
  // The dead image has been tried and given up on before the swap.
  await expect(card.locator('img.og-image:visible')).toHaveCount(0);

  await card.locator('.card-select').press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Refresh preview' }).click();
  await dialog.getByRole('button', { name: 'Use new image' }).click();
  await expect(dialog.locator(`img.view-image[src="${fresh}"]`)).toBeVisible();

  // The card behind the dialog picks it up too, with no reload.
  await expect(card.locator(`img.og-image[src="${fresh}"]`)).toBeVisible();
});

test('re-fetching a dead link changes nothing', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const saved = 'https://example.net/kept.png';
  await putInboxItem(freshRsUser, freshRsToken, {
    item: {
      id: 'dead-link',
      type: 'bookmark',
      title: 'A page that is gone',
      url: 'https://example.net/gone',
      description: 'Still the copy I saved.',
      siteName: 'Example',
      ogImage: saved,
      createdAt: new Date().toISOString(),
    },
  });
  const page = await freshConnectedPage({
    context,
    freshRsUser,
    freshRsToken,
    webOrigin,
  });
  await page.route(SOCKETHUB_GLOB, (route) =>
    route.fulfill(ndjson([{ type: 'error', error: 'could not fetch page' }])),
  );
  await page.route(saved, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );

  await page.goto(webOrigin);
  await page.locator('[data-item-id="dead-link"] .card-select').press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Refresh preview' }).click();

  await expect(
    dialog.getByText('Couldn’t load a preview for this link.'),
  ).toBeVisible();
  await expect(dialog.locator(`img.view-image[src="${saved}"]`)).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'A page that is gone',
  );
  await expect(
    dialog.getByRole('textbox', { name: 'Description' }),
  ).toHaveValue('Still the copy I saved.');
});

test('the incomplete-title hint fetches the title instead of opening the card', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const url = 'https://www.reddit.com/r/hockey/comments/abc/a_post/';
  await putInboxItem(freshRsUser, freshRsToken, {
    item: {
      id: 'site-name-title',
      type: 'bookmark',
      title: 'reddit',
      url,
      createdAt: new Date().toISOString(),
    },
  });
  const page = await freshConnectedPage({
    context,
    freshRsUser,
    freshRsToken,
    webOrigin,
  });
  await page.route(SOCKETHUB_GLOB, (route) =>
    route.fulfill(
      metadataResult(url, {
        type: 'page',
        title: 'You people better be wearing your poppies',
        name: 'reddit',
        url,
      }),
    ),
  );

  await page.goto(webOrigin);
  const card = page.locator('[data-item-id="site-name-title"]');
  await card
    .getByRole('button', { name: 'Title looks incomplete — fetch it?' })
    .click();

  await expect(
    card.getByRole('link', {
      name: 'You people better be wearing your poppies',
    }),
  ).toBeVisible({ timeout: 10_000 });
  // The hint is gone with the problem, and the card never opened.
  await expect(card.getByRole('button', { name: /Title looks/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

/**
 * A Sockethub that also offers the `media` platform: the info request lists
 * it, `fetch` answers with the page's metadata and `download` with
 * `downloadReply`. Returns the `download` requests it received.
 */
async function routeSockethubWithMedia(
  page: Page,
  url: string,
  image: string,
  downloadReply: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const downloads: Array<Record<string, unknown>> = [];
  await page.route(SOCKETHUB_GLOB, (route) => {
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
    const action = request.postDataJSON() as Record<string, unknown>;
    if (action.type === 'download') {
      downloads.push(action);
      return route.fulfill(ndjson([{ ...action, ...downloadReply }]));
    }
    return route.fulfill(
      metadataResult(url, {
        type: 'page',
        title: 'A page with a picture',
        name: 'Example',
        description: 'Saved with its picture',
        image: [{ url: image }],
        url,
      }),
    );
  });
  return downloads;
}

async function serverFile(
  username: string,
  token: string,
  path: string,
): Promise<Response> {
  return fetch(`http://localhost:8000/storage/${username}/inbox/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

test('a captured link keeps its own copy of the preview image, which outlives the original', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const page = await freshConnectedPage({
    context,
    freshRsUser,
    freshRsToken,
    webOrigin,
  });
  const log = attachConsoleCapture(page);
  const url = 'https://example.com/with-picture';
  const image = 'https://cdn.example.com/hero';
  const downloads = await routeSockethubWithMedia(page, url, image, {
    object: {
      type: 'image',
      url: image,
      mediaType: 'image/png',
      size: PNG.byteLength,
      data: PNG.toString('base64'),
    },
  });
  // The image host sends no CORS headers, as most do: the page can show
  // the image but could never read its bytes itself.
  await page.route(image, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );

  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');
  await page
    .getByRole('button', { name: 'Inbox', exact: true })
    .first()
    .click();
  const input = page.getByPlaceholder(
    'Paste a link, jot a note, or drop a file…',
  );
  await input.click();
  await input.fill(url);
  await input.press('Enter');

  // The card ends up showing its own stored copy, not the remote URL.
  const card = page.locator('article.card', {
    has: page.getByRole('link', { name: 'A page with a picture' }),
  });
  await expect(card.locator('img.og-image[src^="blob:"]')).toBeVisible({
    timeout: 15_000,
  });
  expect(downloads).toHaveLength(1);
  expect(downloads[0]).toMatchObject({
    actor: { id: url, type: 'website' },
    object: { type: 'image', url: image },
  });

  // The copy reached the server, next to the item that points at it.
  let stored: Record<string, unknown> | undefined;
  await expect
    .poll(async () => {
      const items = await getInboxItems(freshRsUser, freshRsToken);
      stored = items.find((item) => (item as { url?: string }).url === url) as
        | Record<string, unknown>
        | undefined;
      return stored?.filePath;
    })
    .toBeTruthy();
  expect(stored?.filePath).toBe(`files/${stored?.id}.png`);
  expect(stored).toMatchObject({ mimeType: 'image/png', ogImage: image });
  const file = await serverFile(
    freshRsUser.username,
    freshRsToken,
    stored?.filePath as string,
  );
  expect(file.status).toBe(200);
  expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);

  // The original goes away. After a reload the card still has its image.
  await page.unroute(image);
  await page.route(image, (route) => route.abort());
  await page.reload();
  const reloaded = page.locator('article.card', {
    has: page.getByRole('link', { name: 'A page with a picture' }),
  });
  const kept = reloaded.locator('img.og-image[src^="blob:"]');
  await expect(kept).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => kept.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  assertNoConsoleErrors(log);
});

test('choosing a new image that cannot be downloaded keeps the saved copy', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const url = 'https://example.net/post/3';
  const saved = 'https://example.net/saved.png';
  const fresh = 'https://example.net/newer.png';
  await putInboxFile(freshRsUser, freshRsToken, {
    path: 'files/has-copy.png',
    body: new Uint8Array(PNG),
    contentType: 'image/png',
  });
  await putInboxItem(freshRsUser, freshRsToken, {
    item: {
      id: 'has-copy',
      type: 'bookmark',
      title: 'A post saved with its picture',
      url,
      description: 'Has a local copy of its image.',
      siteName: 'Example',
      ogImage: saved,
      filePath: 'files/has-copy.png',
      mimeType: 'image/png',
      createdAt: new Date().toISOString(),
    },
  });
  const page = await freshConnectedPage({
    context,
    freshRsUser,
    freshRsToken,
    webOrigin,
  });
  await routeSockethubWithMedia(page, url, fresh, {
    error: `Error: image download failed (origin-refused) for ${fresh}: HTTP 403`,
  });
  await page.route(fresh, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );

  await page.goto(webOrigin);
  await page.locator('[data-item-id="has-copy"] .card-select').press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('img.view-image[src^="blob:"]')).toBeVisible({
    timeout: 10_000,
  });
  await dialog.getByRole('button', { name: 'Refresh preview' }).click();
  await dialog.getByRole('button', { name: 'Use new image' }).click();

  await expect(
    dialog.getByText('Couldn’t save the new image — kept the saved one'),
  ).toBeVisible();
  await expect(dialog.locator('img.view-image[src^="blob:"]')).toBeVisible();
  const items = await getInboxItems(freshRsUser, freshRsToken);
  expect(items.find((item) => item.id === 'has-copy')).toMatchObject({
    ogImage: saved,
    filePath: 'files/has-copy.png',
  });
  const file = await serverFile(
    freshRsUser.username,
    freshRsToken,
    'files/has-copy.png',
  );
  expect(file.status).toBe(200);
});

test('with image copies turned off, a saved link shows its image from the site and stores nothing', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const page = await freshConnectedPage({
    context,
    freshRsUser,
    freshRsToken,
    webOrigin,
  });
  const log = attachConsoleCapture(page);
  const url = 'https://example.com/no-copy';
  const image = 'https://cdn.example.com/no-copy-hero';
  const downloads = await routeSockethubWithMedia(page, url, image, {
    object: {
      type: 'image',
      url: image,
      mediaType: 'image/png',
      size: PNG.byteLength,
      data: PNG.toString('base64'),
    },
  });
  await page.route(image, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );

  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  // Turn the setting off where the user does.
  await page.keyboard.press('ControlOrMeta+,');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: /^Link previews/ }).click();
  const keep = settings.getByRole('button', {
    name: 'Keep a copy of preview images',
  });
  await expect(keep).toHaveAttribute('aria-pressed', 'true');
  await keep.click();
  await expect(keep).toHaveAttribute('aria-pressed', 'false');
  // Click the overlay: Escape only collapses the open section.
  await page.mouse.click(5, 5);
  await expect(settings).toBeHidden();

  await page
    .getByRole('button', { name: 'Inbox', exact: true })
    .first()
    .click();
  const input = page.getByPlaceholder(
    'Paste a link, jot a note, or drop a file…',
  );
  await input.click();
  await input.fill(url);
  await input.press('Enter');

  // The preview arrives and the card shows the image straight from its site.
  const card = page.locator('article.card', {
    has: page.getByRole('link', { name: 'A page with a picture' }),
  });
  await expect(card.locator(`img.og-image[src="${image}"]`)).toBeVisible({
    timeout: 15_000,
  });

  // The choice is synced, and nothing was downloaded or stored.
  await expect
    .poll(async () => {
      const r = await fetch(
        `http://localhost:8000/storage/${freshRsUser.username}/inbox/config/user`,
        { headers: { Authorization: `Bearer ${freshRsToken}` } },
      );
      return r.ok ? (await r.json()).keepLinkImages : undefined;
    })
    .toBe(false);
  expect(downloads).toHaveLength(0);
  const items = await getInboxItems(freshRsUser, freshRsToken);
  const stored = items.find((item) => (item as { url?: string }).url === url);
  expect(stored).toMatchObject({ ogImage: image });
  expect((stored as { filePath?: string }).filePath).toBeUndefined();

  assertNoConsoleErrors(log);
});
