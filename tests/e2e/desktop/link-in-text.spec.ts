/**
 * A web address in an item's text is a link, and one on a line of its own
 * gets a preview.
 *
 * An address already in the text (jotted in the capture bar with other
 * words, pasted on the Markdown tab, saved by another app) used to show as
 * plain text in a card's Visual editor: nothing to click. Now it is a
 * link, a pasted one is stored as the bare address, and an address alone
 * on its line shows a card under it with the page's title, description and
 * image, fetched through Sockethub (mocked here with `page.route`).
 *
 * A saved email's text is never looked up: its links can be one-click
 * unsubscribe or confirmation addresses.
 *
 * Service workers are blocked: Playwright route interception can't see
 * requests once a service worker handles them.
 */

import type { EmailItem, NoteItem } from '@inbox-rs/rs-module';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { getInboxItems, putInboxItem } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import {
  assertNoConsoleErrors,
  attachConsoleCapture,
  seedRsSession,
} from '../helpers/pwa';

const SOCKETHUB_GLOB = 'https://sockethub.silverbucket.net/**';
const SITE_GLOB = 'https://docs.example.test/**';
const URL_PASTED = 'https://docs.example.test/guides/getting-started?ref=inbox';
const URL_SAVED = 'https://docs.example.test/changelog';
const PAGE_TITLE = 'Getting started — Example Docs';
const PAGE_SUMMARY = 'Install the tool and build your first project.';

// 1×1 transparent PNG, so the card's image and favicon load.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const NOTE: NoteItem = {
  id: 'note-reading-1',
  type: 'note',
  title: 'Reading list',
  body: `To read this week, after ${URL_SAVED} is done:`,
  createdAt: '2026-11-03T10:00:00.000Z',
};
const EMAIL: EmailItem = {
  id: 'email-newsletter-1',
  type: 'email',
  title: 'Your weekly digest',
  subject: 'Your weekly digest',
  from: 'news@example.test',
  body: `Unsubscribe with one click:\n\n${URL_PASTED}`,
  createdAt: '2026-11-02T10:00:00.000Z',
};

/**
 * Stand in for Sockethub and the linked site. Returns the addresses the
 * app asked Sockethub about.
 */
async function mockPreviewService(context: BrowserContext): Promise<string[]> {
  const asked: string[] = [];
  await context.route(SOCKETHUB_GLOB, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      // The CORS preflight for the JSON POST below.
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
      });
    }
    if (request.method() !== 'POST') return route.fulfill({ status: 404 });
    const activity = request.postDataJSON() as { actor: { id: string } };
    asked.push(activity.actor.id);
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: `${JSON.stringify({
        type: 'fetch',
        actor: activity.actor,
        object: {
          type: 'page',
          title: PAGE_TITLE,
          name: 'Example Docs',
          description: PAGE_SUMMARY,
          image: [{ url: 'https://docs.example.test/card.png' }],
          favicon: 'https://docs.example.test/icon.png',
        },
      })}\n`,
    });
  });
  await context.route(SITE_GLOB, (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
      : route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<title>Example Docs</title>',
        }),
  );
  return asked;
}

/**
 * Click past the end of the last line, where a person puts the cursor to
 * carry on writing. The editor picks the new cursor position up on the
 * browser's next selection event, a moment no person can type inside of
 * but a script can, so give it that turn before the next key.
 */
async function clickEndOfText(page: Page, editor: Locator) {
  await editor.locator('p').last().click();
  await page.evaluate(() => new Promise((done) => setTimeout(done, 50)));
}

async function paste(page: Page, text: string) {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press('ControlOrMeta+V');
}

test.use({
  serviceWorkers: 'block',
  permissions: ['clipboard-read', 'clipboard-write'],
});

test('web addresses in a note are links, and one pasted on its own line gets a preview', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  await putInboxItem(freshRsUser, freshRsToken, { item: NOTE });
  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const asked = await mockPreviewService(context);
  const page = await context.newPage();
  const log = attachConsoleCapture(page);
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: `Open ${NOTE.title}` }).click();
  const dialog = page.getByRole('dialog');
  const editor = dialog.locator('.tiptap-editor');
  await expect(editor).toBeVisible();

  // The address already in the note's text is a link, not plain text.
  await expect(editor.locator(`a[href="${URL_SAVED}"]`)).toHaveText(URL_SAVED);

  await clickEndOfText(page, editor);
  await page.keyboard.press('Enter');
  await paste(page, URL_PASTED);

  // The paste is a link straight away — no trailing space needed.
  const link = editor.locator(`p > a[href="${URL_PASTED}"]`);
  await expect(link).toHaveText(URL_PASTED);

  // Its preview appears under the line, with the page's own details.
  const card = editor.locator('a.link-preview');
  await expect(card).toBeVisible();
  await expect(card.locator('.link-preview-title')).toHaveText(PAGE_TITLE);
  await expect(card.locator('.link-preview-desc')).toHaveText(PAGE_SUMMARY);
  await expect(card.locator('.link-preview-host')).toHaveText('Example Docs');
  await expect(card.locator('img.link-preview-image')).toBeVisible();
  await expect(card.locator('img.link-preview-favicon')).toBeVisible();
  expect(asked, 'the address is looked up once').toEqual([URL_PASTED]);

  // Stored as the address itself: the card is not part of the text.
  await expect
    .poll(
      async () => {
        const items = await getInboxItems(freshRsUser, freshRsToken);
        return (items.find((i) => i.id === NOTE.id) as NoteItem).body;
      },
      { timeout: 15_000 },
    )
    .toBe(`${NOTE.body}\n\n${URL_PASTED}`);

  // The link opens the page in a new tab — one tab, not two.
  const fromLink = context.waitForEvent('page');
  await link.click();
  const linkTab = await fromLink;
  await expect(linkTab).toHaveURL(URL_PASTED);
  expect(context.pages()).toHaveLength(2);
  await linkTab.close();

  // So does the card.
  const fromCard = context.waitForEvent('page');
  await card.click();
  const cardTab = await fromCard;
  await expect(cardTab).toHaveURL(URL_PASTED);
  expect(context.pages()).toHaveLength(2);
  await cardTab.close();
  await expect(dialog, 'the card stays open underneath').toBeVisible();

  // Typing after the address makes it part of a sentence: no preview.
  await clickEndOfText(page, editor);
  await page.keyboard.type(' is the one to start with', { delay: 10 });
  await expect(card).toHaveCount(0);
  await expect(editor.locator(`a[href="${URL_PASTED}"]`)).toHaveText(
    URL_PASTED,
  );

  // Back on its own line, the preview returns without another lookup,
  // in the editor and on the Preview tab, where it replaces the address.
  for (const _ of ' is the one to start with') {
    await page.keyboard.press('Backspace');
  }
  await expect(card).toBeVisible();
  await dialog.getByRole('button', { name: 'Preview' }).click();
  const rendered = dialog.locator('.preview-wrap');
  await expect(rendered.locator('a.link-preview')).toBeVisible();
  await expect(
    rendered.locator('a.link-preview .link-preview-title'),
  ).toHaveText(PAGE_TITLE);
  await expect(
    rendered.locator(`a[href="${URL_PASTED}"]:not(.link-preview)`),
  ).toBeHidden();
  expect(asked, 'no repeat lookups').toEqual([URL_PASTED]);

  assertNoConsoleErrors(log);
  await context.close();
});

test("a saved email's links are never looked up", async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  await putInboxItem(freshRsUser, freshRsToken, { item: EMAIL });
  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const asked = await mockPreviewService(context);
  const page = await context.newPage();
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: `Open ${EMAIL.title}` }).click();
  const editor = page.getByRole('dialog').locator('.tiptap-editor');
  // Still a link the reader can choose to follow…
  await expect(editor.locator(`a[href="${URL_PASTED}"]`)).toBeVisible();
  // …but well past the editor's settle delay, nothing was fetched for it.
  await page.waitForTimeout(1500);
  await expect(editor.locator('a.link-preview')).toHaveCount(0);
  expect(asked).toEqual([]);
  await context.close();
});
