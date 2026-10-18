// Render the built add-on with fictional Thunderbird APIs; no mailbox is opened.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { assertPngSize } from './screenshot-utils.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'packages/thunderbird/dist');
const screenshots = join(root, 'dist/submissions/screenshots');
mkdirSync(screenshots, { recursive: true });
const server = createServer((req, res) => {
  const path = resolve(
    dist,
    `.${new URL(req.url, 'http://localhost').pathname}`,
  );
  if (!path.startsWith(`${dist}/`)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const content = readFileSync(path);
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
      }[extname(path)] ?? 'application/octet-stream',
    );
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', (route) =>
    route.request().url().startsWith(`${base}/`)
      ? route.continue()
      : route.abort(),
  );
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const storage = {};
    if (sessionStorage.getItem('connected')) {
      storage['inbox-rs-config'] = {
        userAddress: 'alex@provider.example',
        token: 'fictional-screenshot-token',
        href: 'https://storage.example/alex/',
        storageApi: 'draft-dejong-remotestorage-22',
      };
    }
    const api = {
      storage: {
        local: {
          get: async (key) => ({ [key]: storage[key] }),
          set: async (values) => Object.assign(storage, values),
          remove: async (key) => {
            delete storage[key];
          },
        },
      },
      tabs: { query: async () => [{ id: 1 }] },
      messageDisplay: {
        getDisplayedMessage: async () => ({
          id: 1,
          subject: 'Quarterly planning notes',
          author: 'Alex Example alex@example.org',
          headerMessageId: '<quarterly-planning@example.org>',
        }),
      },
      messages: {
        getFull: async () => ({
          contentType: 'text/plain',
          body: 'Let’s review our priorities for the coming quarter.\nPlease bring your ideas to Monday’s planning meeting.',
        }),
      },
      runtime: { openOptionsPage: async () => {} },
      identity: {
        getRedirectURL: () => 'https://example.org/fictional-redirect',
      },
    };
    globalThis.browser = api;
    globalThis.messenger = api;
  });
  async function capture(name) {
    const path = join(screenshots, name);
    await page.screenshot({ path });
    assertPngSize(path);
  }
  await page.goto(`${base}/src/options/index.html`);
  await page.locator('#address').fill('alex@provider.example');
  await capture('thunderbird-setup.png');
  await page.evaluate(() => sessionStorage.setItem('connected', 'true'));
  await page.reload();
  await page.locator('.status-card.connected').waitFor();
  await capture('thunderbird-connected.png');
  await page.goto(`${base}/src/popup/index.html`);
  await page.locator('input').waitFor();
  assert.equal(
    await page.locator('input').inputValue(),
    'Quarterly planning notes',
  );
  await page.locator('textarea').fill('Follow up Monday');
  await page.addStyleTag({
    content:
      'body { width: 100%; min-height: 100vh; display: grid; place-items: center; background: #e8eaf0; } #app { width: 360px; background: var(--bg); border-radius: 12px; box-shadow: 0 16px 48px #0003; }',
  });
  await capture('thunderbird-save-popup.png');
  assert.deepEqual(errors, [], 'Screenshot pages must load without errors');

  await page.unroute('**/*');
  await page.setViewportSize({ width: 440, height: 280 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const logo = readFileSync(join(root, 'docs/assets/inbox-rs.svg')).toString(
    'base64',
  );
  await page.setContent(
    `<!doctype html><html lang="en"><title>Inbox RS</title><style>body{margin:0;width:440px;height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;background:#0f1117;color:#e4e6eb;font:600 23px system-ui;text-align:center}img{width:310px;height:80px}p{margin:0;max-width:360px}</style><img alt="Inbox RS" src="data:image/svg+xml;base64,${logo}"><p>Save anything to your own storage</p></html>`,
  );
  await page.locator('img').evaluate((img) => img.decode());
  const promo = join(screenshots, 'chromium-promo-440x280.png');
  await page.screenshot({ path: promo });
  assertPngSize(promo, 440, 280);
  console.log(`Thunderbird screenshots and Chromium promo: ${screenshots}`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
