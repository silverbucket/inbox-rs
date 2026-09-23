// Real browser extension smoke tests. The HTTP receiver is a test fixture,
// not application server code. OAuth is seeded; no real account is accessed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const screenshots = join(root, 'dist/submissions/screenshots');
mkdirSync(screenshots, { recursive: true });
const uploads = [];
let rejectWrites = false;
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.method === 'PUT') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (rejectWrites) {
      res.writeHead(503).end();
      return;
    }
    assert.equal(req.headers.authorization, 'Bearer demonstration-token');
    uploads.push({
      path: req.url,
      type: req.headers['content-type'],
      body: Buffer.concat(chunks),
    });
    res.writeHead(201).end();
    return;
  }
  if (req.url === '/sample.png') {
    res.setHeader('Content-Type', 'image/png');
    res.end(readFileSync(join(root, 'packages/extension/icons/icon-128.png')));
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(
    '<!doctype html><title>Weekend reading</title><meta name="description" content="A demonstration page for Inbox RS"><h1>Weekend reading</h1><p>A place to collect interesting ideas.</p>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const config = {
  userAddress: 'demo@storage.example',
  token: 'demonstration-token',
  href: `${base}/storage`,
  storageApi: 'draft-dejong-remotestorage-22',
};

async function launch(target, binary, temporary) {
  if (target === 'chromium') {
    const extension = join(temporary, 'extension');
    execFileSync('unzip', ['-q', binary, '-d', extension]);
    const context = await chromium.launchPersistentContext(
      join(temporary, 'profile'),
      {
        channel: 'chromium',
        headless: true,
        viewport: { width: 1280, height: 800 },
        args: [
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
      },
    );
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker'));
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    return {
      origin,
      goto: (url) => page.goto(url),
      evaluate: (fn, arg) => page.evaluate(fn, arg),
      fill: (css, text) => page.locator(css).fill(text),
      click: (css) => page.locator(css).click(),
      wait: (css) => page.locator(css).waitFor(),
      text: (css) => page.locator(css).innerText(),
      screenshot: (path) => page.screenshot({ path }),
      close: () => context.close(),
    };
  }
  const uuid = '2cf2eb4c-9d72-44eb-a0f1-134d998ac201';
  const options = new firefox.Options()
    .addArguments('-headless')
    .setPreference(
      'extensions.webextensions.uuids',
      JSON.stringify({ 'inbox-rs@silverbucket.net': uuid }),
    );
  if (process.env.FIREFOX_BINARY) options.setBinary(process.env.FIREFOX_BINARY);
  const driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(
      new firefox.ServiceBuilder().addArguments('--allow-system-access'),
    )
    .build();
  try {
    await driver.installAddon(binary, true);
    await driver.manage().window().setRect({ width: 1280, height: 900 });
  } catch (error) {
    await driver.quit();
    throw error;
  }
  const element = (css) =>
    driver.wait(until.elementLocated(By.css(css)), 15000);
  return {
    origin: `moz-extension://${uuid}`,
    goto: async (url) => {
      await driver.setContext('chrome');
      try {
        await driver.executeScript(
          'gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });',
          url,
        );
      } finally {
        await driver.setContext('content');
      }
      await driver.wait(until.urlIs(url), 15000);
      await driver.wait(
        async () =>
          (await driver.executeScript('return document.readyState')) ===
          'complete',
        15000,
      );
    },
    evaluate: (fn, arg) =>
      driver.executeScript(`return (${fn.toString()})(arguments[0]);`, arg),
    fill: async (css, text) => {
      const el = await element(css);
      await el.clear();
      await el.sendKeys(text);
    },
    click: async (css) => (await element(css)).click(),
    wait: element,
    text: async (css) => (await element(css)).getText(),
    screenshot: async (path) =>
      writeFileSync(path, await driver.takeScreenshot(), 'base64'),
    close: () => driver.quit(),
  };
}

try {
  const targets = process.argv.slice(2);
  for (const target of targets.length ? targets : ['chromium', 'firefox']) {
    const temporary = mkdtempSync(join(tmpdir(), 'inbox-rs-browser-'));
    let browser;
    try {
      const output = join(root, 'dist/submissions', target);
      const name = readdirSync(output).find(
        (name) => !name.includes('-source') && /\.(zip|xpi)$/.test(name),
      );
      browser = await launch(target, join(output, name), temporary);
      const optionsUrl = `${browser.origin}/src/options/index.html`;
      const popupUrl = `${browser.origin}/src/popup/index.html`;
      await browser.goto(popupUrl);
      assert.match(
        await browser.text('.not-connected'),
        /Connect your remoteStorage/,
      );
      await browser.goto(optionsUrl);
      await browser.fill('#address', 'demo@storage.example');
      await browser.screenshot(join(screenshots, `${target}-setup.png`));
      await browser.evaluate(async (config) => {
        await chrome.storage.local.set({ 'inbox-rs-config': config });
      }, config);
      // Verify content-script injection and messaging in the installed build.
      const metadata = await browser.evaluate(async (url) => {
        const tab = await chrome.tabs.create({ url, active: false });
        try {
          for (let i = 0; i < 100; i++) {
            try {
              const result = await chrome.tabs.sendMessage(tab.id, {
                type: 'get-metadata',
              });
              if (result?.title) return result;
            } catch {}
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error('Content script did not respond');
        } finally {
          await chrome.tabs.remove(tab.id);
        }
      }, `${base}/article`);
      assert.equal(metadata.title, 'Weekend reading');
      await browser.goto(popupUrl);
      await browser.fill('input[placeholder="Title"]', 'Weekend reading');
      await browser.fill('input[placeholder="URL"]', `${base}/article`);
      await browser.fill('textarea', 'Read this over the weekend.');
      await browser.screenshot(join(screenshots, `${target}-save-page.png`));
      await browser.click('button[type="submit"]');
      await browser.wait('.saved');
      const bookmark = JSON.parse(uploads.at(-1).body);
      assert.equal(bookmark.type, 'bookmark');
      assert.equal(bookmark.url, `${base}/article`);
      assert.equal(bookmark.title, 'Weekend reading');
      assert.match(bookmark.description, /Read this over the weekend/);
      await browser.goto(popupUrl);
      await browser.click('.tabs button:nth-child(2)');
      await browser.fill('input', 'An idea to revisit');
      await browser.fill('textarea', 'Make time for a short walk after lunch.');
      await browser.screenshot(join(screenshots, `${target}-quick-note.png`));
      rejectWrites = true;
      await browser.click('button[type="submit"]');
      await browser.wait('[role="alert"]');
      assert.match(await browser.text('[role="alert"]'), /503|fail/i);
      rejectWrites = false;
      await browser.click('button[type="submit"]');
      await browser.wait('.saved');
      const note = JSON.parse(uploads.at(-1).body);
      assert.equal(note.type, 'note');
      assert.equal(note.body, 'Make time for a short walk after lunch.');
      await browser.goto(optionsUrl);
      const result = await browser.evaluate(
        async (base) =>
          chrome.runtime.sendMessage({
            type: 'download-and-store-image',
            url: `${base}/sample.png`,
            filePath: 'files/demo.png',
          }),
        base,
      );
      assert.equal(result.ok, true);
      assert.equal(uploads.at(-1).type, 'image/png');
      assert(
        uploads
          .at(-1)
          .body.equals(
            readFileSync(join(root, 'packages/extension/icons/icon-128.png')),
          ),
      );
      await browser.click('.btn-disconnect');
      await browser.goto(popupUrl);
      await browser.wait('.not-connected');
      console.log(
        `${target}: installed; metadata, bookmark, note, failed-save retry, image upload and disconnect passed`,
      );
    } finally {
      rejectWrites = false;
      if (browser) await browser.close();
      rmSync(temporary, { recursive: true, force: true });
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
