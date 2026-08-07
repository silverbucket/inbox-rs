import { expect, test } from '../helpers/fixtures';

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

  test('a dormant install loads the newest release directly', async ({
    browser,
    webOrigin,
  }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const oldPage = await context.newPage();
      await oldPage.goto(webOrigin);
      await expect(
        oldPage.getByRole('button', { name: 'Inbox' }).first(),
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
        page.getByRole('button', { name: 'Inbox' }).first(),
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
        page.getByRole('button', { name: 'Inbox' }).first(),
      ).toBeVisible();
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
