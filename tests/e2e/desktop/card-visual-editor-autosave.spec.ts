/**
 * Regression: edits typed into a card's Visual (rich-text) editor must be
 * persisted when the card modal closes, however it closes.
 *
 * The card modal autosaves. A user opens a card, types in the Visual tab,
 * and dismisses the modal — with Escape, the Back button, a click on the
 * backdrop, or by navigating elsewhere (the browser back button on mobile
 * lands here). Reopening the card (and reloading the page) must show the
 * new text. Nothing in that flow presses a Save button; closing *is* the
 * save.
 */

import type { NoteItem } from '@inbox-rs/rs-module';
import type { Page } from '@playwright/test';
import {
  getInboxItems,
  putInboxItem,
  type RsUser,
} from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import {
  assertNoConsoleErrors,
  attachConsoleCapture,
  seedRsSession,
} from '../helpers/pwa';

type CloseMethod = 'escape' | 'back-button' | 'backdrop' | 'navigate';

const CLOSE_METHODS: CloseMethod[] = [
  'escape',
  'back-button',
  'backdrop',
  'navigate',
];

async function closeModal(page: Page, how: CloseMethod): Promise<void> {
  if (how === 'escape') {
    await page.keyboard.press('Escape');
  } else if (how === 'back-button') {
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Back', exact: true })
      .click();
  } else if (how === 'backdrop') {
    // The overlay fills the viewport; the modal sits centred, so a corner
    // click lands on the backdrop.
    await page
      .locator('.overlay')
      .first()
      .click({ position: { x: 5, y: 5 } });
  } else {
    // Route change — what the browser back button / a nav tap produces.
    await page.evaluate(() => {
      window.location.hash = '#/todos';
    });
  }
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
  if (how === 'navigate') {
    await page.getByRole('button', { name: 'Inbox' }).first().click();
  }
}

async function openCard(page: Page, title: string): Promise<void> {
  const open = page.getByRole('button', { name: `Open ${title}` });
  await expect(open).toBeVisible({ timeout: 10_000 });
  await open.click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
}

/** Click into the Visual editor and append `text` at the end of the body. */
async function typeInVisualEditor(page: Page, text: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Visual' }).click();
  const editor = dialog.locator('.tiptap-editor');
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text, { delay: 20 });
  await expect(editor).toContainText(text);
}

/**
 * Poll the server until the note titled `title` carries every `texts` entry
 * in its body. remoteStorage pushes local writes on its own sync cadence, so
 * a short wait is expected — but the write must eventually leave the device
 * without the user reopening anything.
 */
async function expectBodyOnServer(
  user: RsUser,
  token: string,
  title: string,
  texts: string[],
): Promise<void> {
  await expect
    .poll(
      async () => {
        const items = await getInboxItems(user, token);
        const note = items.find((i) => i.title === title);
        const body = note && 'body' in note ? (note.body ?? '') : '';
        return texts.every((t) => body.includes(t));
      },
      {
        timeout: 15_000,
        message: `server copy of "${title}" has ${texts.join(', ')}`,
      },
    )
    .toBe(true);
}

async function expectBodyAfterReload(
  page: Page,
  webOrigin: string,
  title: string,
  texts: string[],
): Promise<void> {
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Inbox' }).first().click();
  await openCard(page, title);
  const editor = page.getByRole('dialog').locator('.tiptap-editor');
  for (const text of texts) {
    await expect(editor).toContainText(text, { timeout: 10_000 });
  }
}

for (const how of CLOSE_METHODS) {
  test(`text typed in the Visual editor survives closing the card via ${how}`, async ({
    connectedPage,
    webOrigin,
    rsUser,
    rsToken,
  }) => {
    const log = attachConsoleCapture(connectedPage);
    await connectedPage.goto(webOrigin);
    await connectedPage.waitForLoadState('networkidle');
    await connectedPage.getByRole('button', { name: 'Inbox' }).first().click();

    // Seed a note through the capture bar (dotless so it's never a bookmark).
    const title = `visual autosave ${how} note`;
    const input = connectedPage.getByPlaceholder(
      'Paste a link, jot a note, or drop a file…',
    );
    await input.click();
    await input.fill(title);
    await input.press('Enter');

    await openCard(connectedPage, title);
    const typed = `typed via ${how} sentinel`;
    await typeInVisualEditor(connectedPage, typed);
    await closeModal(connectedPage, how);

    // Closing is the save: the edit must reach the server without the user
    // touching the card again. A device-local recovery draft is not enough —
    // it never syncs until this card is reopened on this device.
    await expectBodyOnServer(rsUser, rsToken, title, [typed]);

    // Reopen: the edit must be there, and a second round of typing must
    // stick too (the editor is re-mounted on every open).
    await openCard(connectedPage, title);
    await expect(
      connectedPage.getByRole('dialog').locator('.tiptap-editor'),
    ).toContainText(typed, { timeout: 10_000 });
    const typedAgain = `second pass ${how}`;
    await typeInVisualEditor(connectedPage, typedAgain);
    await closeModal(connectedPage, how);
    await expectBodyOnServer(rsUser, rsToken, title, [typed, typedAgain]);

    // And it must have reached storage, not just component state.
    await expectBodyAfterReload(connectedPage, webOrigin, title, [
      typed,
      typedAgain,
    ]);

    assertNoConsoleErrors(log);
  });
}

test('edits to a note whose markdown the Visual editor rewrites on load still save', async ({
  browser,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  // Markdown that does not round-trip byte-for-byte through the rich editor:
  // a trailing newline, `*` bullets, and a task list. On open the editor
  // normalises this — the user's subsequent typing must still be saved.
  const title = 'normalised markdown note';
  const seeded: NoteItem = {
    id: 'note-normalised-1',
    type: 'note',
    title,
    body: '# Heading\n\n* one\n* two\n\n- [ ] task\n\nParagraph text\n',
    createdAt: '2026-08-01T10:00:00.000Z',
  };
  await putInboxItem(freshRsUser, freshRsToken, { item: seeded });

  const context = await browser.newContext();
  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const page = await context.newPage();
  const log = attachConsoleCapture(page);
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Inbox' }).first().click();

  await openCard(page, title);
  const typed = 'appended after normalisation';
  await typeInVisualEditor(page, typed);
  await closeModal(page, 'escape');

  await openCard(page, title);
  await expect(
    page.getByRole('dialog').locator('.tiptap-editor'),
  ).toContainText(typed, { timeout: 10_000 });
  await closeModal(page, 'escape');

  await expectBodyAfterReload(page, webOrigin, title, [
    'Paragraph text',
    typed,
  ]);

  assertNoConsoleErrors(log);
  await context.close();
});

test('text typed in the Visual editor is saved when the page is left right away', async ({
  connectedContext,
  webOrigin,
  rsUser,
  rsToken,
}) => {
  // Closing the PWA window, switching tabs, or the phone backgrounding the
  // app is how a lot of edits end — often inside the autosave debounce. The
  // pending write must be pushed, not left in a device-local draft that only
  // syncs if this exact card is reopened on this exact device.
  const page = await connectedContext.newPage();
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Inbox' }).first().click();

  const title = 'visual autosave page left note';
  const input = page.getByPlaceholder(
    'Paste a link, jot a note, or drop a file…',
  );
  await input.click();
  await input.fill(title);
  await input.press('Enter');

  await openCard(page, title);
  const typed = 'typed then page left sentinel';
  await typeInVisualEditor(page, typed);
  // Leave within the debounce window: the page is hidden and unloaded.
  await page.goto('about:blank');

  // Boot the app again in a fresh page and let it sync — without opening the
  // card. The server must already have (or now receive) the text.
  const next = await connectedContext.newPage();
  await next.goto(webOrigin);
  await next.waitForLoadState('networkidle');
  await expectBodyOnServer(rsUser, rsToken, title, [typed]);

  await next.getByRole('button', { name: 'Inbox' }).first().click();
  await openCard(next, title);
  await expect(
    next.getByRole('dialog').locator('.tiptap-editor'),
  ).toContainText(typed, { timeout: 10_000 });
  await page.close();
  await next.close();
});
