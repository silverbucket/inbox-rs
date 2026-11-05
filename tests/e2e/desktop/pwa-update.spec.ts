import { expect, test } from '../helpers/fixtures';
import { waitForServiceWorkerController } from '../helpers/pwa';

test.describe('PWA release transitions', () => {
  test('HTML shells depend only on the stable bootloader', async ({
    request,
    webOrigin,
  }) => {
    for (const path of ['/', '/capture/']) {
      const html = await (await request.get(`${webOrigin}${path}`)).text();
      expect(html).toContain('<script src="/app-loader.js"></script>');
      expect(html).not.toMatch(/<script[^>]+src="\/assets\//);
    }
  });

  test('the stable bootloader starts the separate capture entry', async ({
    browser,
    webOrigin,
  }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await page.goto(`${webOrigin}/capture/`);
      await expect(
        page.getByText('Quick Capture', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Settings' }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('capture boots from cached manifest without waiting on the network manifest', async ({
    browser,
    webOrigin,
  }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await page.goto(`${webOrigin}/capture/`);
      await expect(
        page.getByText('Quick Capture', { exact: true }),
      ).toBeVisible();

      await page.route('**/asset-manifest.json*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await route.continue();
      });

      const start = Date.now();
      await page.reload();
      await expect(
        page.getByText('Quick Capture', { exact: true }),
      ).toBeVisible();
      expect(Date.now() - start).toBeLessThan(2500);
    } finally {
      await context.close();
    }
  });

  test('capture query-string navigation serves the capture shell from the service worker', async ({
    browser,
    webOrigin,
  }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${webOrigin}/capture/`);
      await waitForServiceWorkerController(page);

      let captureDocumentFromNetwork = false;
      await page.route('**/capture/**', async (route) => {
        if (route.request().resourceType() === 'document') {
          captureDocumentFromNetwork = true;
        }
        await route.continue();
      });

      await page.goto(`${webOrigin}/capture/?title=Shared&text=hello`);
      await expect(
        page.getByText('Quick Capture', { exact: true }),
      ).toBeVisible();
      await expect(page.locator('#app')).toHaveCount(0);
      expect(captureDocumentFromNetwork).toBe(false);
    } finally {
      await context.close();
    }
  });

  test('a POST share with a file lands in capture via the service worker', async ({
    browser,
    webOrigin,
  }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${webOrigin}/capture/`);
      await waitForServiceWorkerController(page);

      // Submit the same multipart POST the OS share sheet sends to the
      // manifest's share_target action.
      await page.evaluate(() => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/capture/';
        form.enctype = 'multipart/form-data';
        form.innerHTML =
          '<input name="title" value="Invite"><input type="file" name="files">';
        document.body.append(form);
      });
      await page.locator('input[type=file]').setInputFiles({
        name: 'invite.ics',
        mimeType: 'text/calendar',
        buffer: Buffer.from(
          'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Standup\nDTSTART:20261110T090000Z\nEND:VEVENT\nEND:VCALENDAR',
        ),
      });
      // Deferred so the navigation doesn't tear down this evaluate call.
      await page.evaluate(() => {
        setTimeout(() => document.querySelector('form')?.submit());
      });

      // Redirected to the capture shell with the text carried over (then
      // scrubbed), and the file queued as a scheduled note.
      await expect(page.getByPlaceholder('Jot it down…')).toHaveValue('Invite');
      await expect
        .poll(() =>
          page.evaluate(() =>
            JSON.parse(
              localStorage.getItem('inbox-rs-capture:history') ?? '[]',
            ).map((r: { item: { type: string; title: string } }) => [
              r.item.type,
              r.item.title,
            ]),
          ),
        )
        .toEqual([['note', 'Standup']]);
      expect(
        await page.evaluate(async () =>
          (await caches.open('share-target')).keys().then((k) => k.length),
        ),
      ).toBe(0);
    } finally {
      await context.close();
    }
  });

  test('a dormant install loads the newest release directly', async ({
    browser,
    webOrigin,
  }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const oldPage = await context.newPage();
      await oldPage.goto(webOrigin);
      await expect(
        oldPage.getByRole('button', { name: 'Inbox', exact: true }).first(),
      ).toBeVisible();
      await oldPage.close();

      const returningPage = await context.newPage();
      await returningPage.route('**/asset-manifest.json*', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            'src/main.ts': {
              file: 'assets/release-5.js',
              isEntry: true,
            },
          }),
        }),
      );
      await returningPage.route('**/assets/release-5.js', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: `document.getElementById('app').innerHTML = '<main><h1>Release 5</h1></main>';`,
        }),
      );

      await returningPage.goto(webOrigin);
      await expect(
        returningPage.getByRole('heading', { name: 'Release 5' }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('a broken current release falls back to the last working release', async ({
    browser,
    webOrigin,
  }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await page.goto(webOrigin);
      await expect(
        page.getByRole('button', { name: 'Inbox', exact: true }).first(),
      ).toBeVisible();

      await page.route('**/asset-manifest.json*', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            'src/main.ts': {
              file: 'assets/missing-release.js',
              isEntry: true,
            },
          }),
        }),
      );
      await page.route('**/assets/missing-release.js', (route) =>
        route.fulfill({ status: 404, body: 'missing' }),
      );

      await page.reload();
      await expect(
        page.getByRole('button', { name: 'Inbox', exact: true }).first(),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('a failed release removes its CSS before loading a fallback', async ({
    browser,
    webOrigin,
  }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await page.goto(webOrigin);
      await expect(
        page.getByRole('button', { name: 'Inbox', exact: true }).first(),
      ).toBeVisible();

      await page.route('**/asset-manifest.json*', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            'src/main.ts': {
              file: 'assets/missing-release.js',
              css: ['assets/failed-release.css'],
              isEntry: true,
            },
          }),
        }),
      );
      await page.route('**/assets/failed-release.css', (route) =>
        route.fulfill({
          contentType: 'text/css',
          body: ':root { --failed-release-loaded: 1; }',
        }),
      );
      await page.route('**/assets/missing-release.js', (route) =>
        route.fulfill({ status: 404, body: 'missing' }),
      );

      await page.reload();
      await expect(
        page.getByRole('button', { name: 'Inbox', exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.locator('link[href*="failed-release.css"]'),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('rejects cross-origin asset paths from a boot manifest', async ({
    browser,
    webOrigin,
  }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      const crossOriginRequests: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('evil.example')) {
          crossOriginRequests.push(request.url());
        }
      });
      await page.route('**/asset-manifest.json*', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            'src/main.ts': {
              file: '//evil.example/pwn.js',
              isEntry: true,
            },
          }),
        }),
      );

      await page.goto(webOrigin);
      await expect(
        page.getByRole('heading', { name: 'Could not load the app' }),
      ).toBeVisible();
      expect(crossOriginRequests).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('a first-load bundle failure shows recovery UI, never a white screen', async ({
    browser,
    webOrigin,
  }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await page.route('**/asset-manifest.json*', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            'src/main.ts': {
              file: 'assets/missing-release.js',
              isEntry: true,
            },
          }),
        }),
      );
      await page.route('**/assets/missing-release.js', (route) =>
        route.fulfill({ status: 404, body: 'missing' }),
      );

      await page.goto(webOrigin);
      await expect(
        page.getByRole('heading', { name: 'Could not load the app' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Try again' }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
