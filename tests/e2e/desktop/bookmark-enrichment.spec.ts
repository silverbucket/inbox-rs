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
import { putInboxItem } from '../helpers/armadietto';
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
