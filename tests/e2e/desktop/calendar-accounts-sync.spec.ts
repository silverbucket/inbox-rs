/**
 * Calendar accounts follow the user between devices; the password doesn't.
 *
 * Two browser contexts stand in for two devices on one storage account.
 * The account is connected on the first; the second must receive it
 * without being asked to set it up again, hold it "paused" until its
 * password is entered there, and never see that password arrive through
 * storage. The CalDAV relay is mocked, and only accepts the right password.
 */

import type { BrowserContext, Page } from '@playwright/test';
import { getInboxFolder } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

const RELAY_GLOB = 'https://sockethub.silverbucket.net/**';
const PASSWORD = 'app-pass-1234';
const CALENDARS = [
  {
    id: 'https://cal.example.org/nick/personal/',
    type: 'calendar',
    name: 'Personal',
    components: ['event', 'task'],
  },
  {
    id: 'https://cal.example.org/nick/work/',
    type: 'calendar',
    name: 'Work',
    components: ['event'],
  },
];

/** A relay that knows one account and rejects any other password. */
async function mockRelay(context: BrowserContext) {
  await context.route(RELAY_GLOB, (route) => {
    const [credentials] = JSON.parse(route.request().postData() ?? '[]');
    const ok = credentials?.object?.password === PASSWORD;
    return route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: `${JSON.stringify(
        ok
          ? { type: 'collection', items: CALENDARS }
          : { type: 'error', error: 'caldav:authentication-failed' },
      )}\n`,
    });
  });
}

async function openCalendarSettings(page: Page) {
  await page.getByRole('button', { name: /^User menu/ }).click();
  await page.getByRole('button', { name: /^Calendars/ }).click();
}

test('a calendar account set up on one device needs only its password on the next', async ({
  browser,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  test.setTimeout(90_000);
  const deviceA = await browser.newContext();
  const deviceB = await browser.newContext();
  for (const device of [deviceA, deviceB]) {
    await seedRsSession(device, freshRsUser, freshRsToken, {
      clientOrigin: webOrigin,
    });
    await mockRelay(device);
  }

  // --- Device A: connect the account as usual. ---
  const a = await deviceA.newPage();
  await a.goto(webOrigin);
  await openCalendarSettings(a);
  await a.getByRole('button', { name: '+ Add calendar account' }).click();
  await a.getByLabel('Server').fill('cal.example.org');
  await a.getByLabel('Username').fill('nick');
  await a.getByLabel('App password').fill(PASSWORD);
  await a.getByRole('button', { name: 'Connect & find calendars' }).click();
  await expect(a.getByText('Found 2 calendars')).toBeVisible();

  // The account reaches storage — without the password.
  await expect
    .poll(
      async () =>
        Object.keys(
          await getInboxFolder(freshRsUser, freshRsToken, 'calendar-accounts'),
        ).length,
      { timeout: 30_000 },
    )
    .toBe(1);
  const stored = JSON.stringify(
    await getInboxFolder(freshRsUser, freshRsToken, 'calendar-accounts'),
  );
  expect(stored).toContain('cal.example.org');
  expect(stored).toContain('"username":"nick"');
  expect(stored).not.toContain(PASSWORD);
  expect(stored).not.toContain('password');

  // --- Device B: the account is already there, waiting for its password. ---
  const b = await deviceB.newPage();
  await b.goto(webOrigin);
  await b
    .getByRole('button', { name: /^Todos/ })
    .first()
    .click();
  const banner = b.getByText(
    'Finish connecting cal.example.org on this device',
  );
  await expect(banner).toBeVisible({ timeout: 30_000 });

  // Nothing was asked for unprompted.
  await expect(b.getByRole('dialog')).toHaveCount(0);

  await b.getByRole('button', { name: 'Enter password' }).click();
  const sheet = b.getByRole('dialog', {
    name: 'Connect cal.example.org on this device',
  });
  await expect(sheet).toBeVisible();
  // What synced is shown, not asked for again.
  await expect(sheet.getByText('nick', { exact: true })).toBeVisible();
  await expect(
    sheet.getByText(/never saved to your synced storage/),
  ).toBeVisible();

  // A wrong password fails right here and saves nothing.
  await sheet.getByLabel('App password').fill('wrong');
  await sheet.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('Sign-in failed');
  await expect(sheet).toBeVisible();

  await sheet.getByLabel('App password').fill(PASSWORD);
  await sheet.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(banner).toHaveCount(0);

  // Same calendars as device A, usable now.
  await openCalendarSettings(b);
  await expect(b.getByText('Personal', { exact: true })).toBeVisible();
  await expect(b.getByText('Work', { exact: true })).toBeVisible();
  await expect(
    b.getByRole('button', { name: 'Link to a collection…' }).first(),
  ).toBeVisible();

  // The password stayed on the device that typed it.
  expect(
    await b.evaluate(() => localStorage.getItem('inbox-rs:calendar-accounts')),
  ).toContain(PASSWORD);
  expect(
    JSON.stringify(
      await getInboxFolder(freshRsUser, freshRsToken, 'calendar-accounts'),
    ),
  ).not.toContain(PASSWORD);

  // --- Removing it on B removes it from A too. ---
  await b.getByRole('button', { name: 'Remove', exact: true }).click();
  await b.getByRole('button', { name: 'Remove from all devices?' }).click();
  await expect(b.getByText('No accounts connected yet.')).toBeVisible();
  await expect(a.getByText('No accounts connected yet.')).toBeVisible({
    timeout: 40_000,
  });

  await deviceA.close();
  await deviceB.close();
});

test('dismissing the note is remembered, and settings still offers the password', async ({
  browser,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  test.setTimeout(60_000);
  const device = await browser.newContext();
  await seedRsSession(device, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  await mockRelay(device);
  // An account this device has heard about but holds no password for.
  await device.addInitScript(() => {
    if (localStorage.getItem('inbox-rs:calendar-accounts')) return;
    localStorage.setItem(
      'inbox-rs:calendar-accounts',
      JSON.stringify([
        {
          id: 'seeded',
          label: 'Fastmail',
          url: 'https://cal.example.org/',
          username: 'nick',
          password: '',
          endpoint: '',
          calendars: [
            {
              id: 'https://cal.example.org/nick/personal/',
              name: 'Personal',
              components: ['event', 'task'],
            },
          ],
        },
      ]),
    );
  });

  const page = await device.newPage();
  await page.goto(webOrigin);
  await page
    .getByRole('button', { name: /^Todos/ })
    .first()
    .click();
  const banner = page.getByText('Finish connecting Fastmail on this device');
  await expect(banner).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toHaveCount(0);

  await page.reload();
  await page
    .getByRole('button', { name: /^Todos/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Todos' })).toBeVisible();
  await expect(banner).toHaveCount(0);

  await openCalendarSettings(page);
  await expect(page.getByText(/Set up on another device/)).toBeVisible();
  await page.getByRole('button', { name: 'Enter password' }).click();
  const sheet = page.getByRole('dialog', {
    name: 'Connect Fastmail on this device',
  });
  await sheet.getByLabel('App password').fill(PASSWORD);
  await sheet.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('Personal', { exact: true })).toBeVisible();
  await expect(page.getByText(/Set up on another device/)).toHaveCount(0);

  await device.close();
});
