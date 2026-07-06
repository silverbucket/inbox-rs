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
        favicon: 'https://example.com/favicon.ico',
        url,
      }),
    ),
  );
  // Serve real image bytes for the og:image URL — the card hides broken
  // images via `onerror`, so the visibility assertion needs a loadable src.
  await connectedPage.route('https://example.com/og.png', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    }),
  );

  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');
  await connectedPage.getByRole('button', { name: 'Inbox' }).first().click();

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
  await connectedPage.getByRole('button', { name: 'Inbox' }).first().click();

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
  await expect(dialog.getByRole('link', { name: 'Example Org' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(dialog.getByText('Recovered metadata')).toBeVisible();

  assertNoConsoleErrors(log);
});
