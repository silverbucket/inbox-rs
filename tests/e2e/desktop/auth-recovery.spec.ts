import type { Page } from '@playwright/test';
import { getInboxItems, type RsUser } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

// Use actual OAuth, not seedRsSession: its init script overwrites credentials
// on every navigation and would hide callback/reload regressions.
/** Start a real OAuth flow from the disconnected account form. */
async function beginConnect(page: Page, origin: string, user: RsUser) {
  await page.goto(origin);
  await page.getByRole('button', { name: 'User menu — disconnected' }).click();
  await page.getByRole('button', { name: /^Account — Not connected/ }).click();
  await page.getByPlaceholder('user@storage.example').fill(user.address);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForURL(/^http:\/\/localhost:8000\/oauth\//);
}

/** Grant access at the test storage server and wait for app connection. */
async function allow(page: Page, origin: string, user: RsUser) {
  await page.locator('input[name="password"]').fill(user.password);
  await page.locator('button[name="allow"]').click();
  await page.waitForURL(`${origin}/**`);
  await expect(
    page.getByRole('button', { name: 'User menu — connected' }),
  ).toBeVisible();
}

/** Save a note through the app and wait for it to appear in the local view. */
async function capture(page: Page, title: string) {
  const input = page.getByPlaceholder(
    'Paste a link, jot a note, or drop a file…',
  );
  await input.fill(title);
  await input.press('Enter');
  await expect(
    page.getByRole('button', { name: `Open ${title}`, exact: true }),
  ).toBeVisible();
}

for (const status of [401, 403]) {
  test(`${status}: queued changes survive reload and OAuth reconnection`, async ({
    page,
    freshRsUser,
    freshRsToken,
    webOrigin,
  }) => {
    test.setTimeout(90_000);
    await beginConnect(page, webOrigin, freshRsUser);
    await allow(page, webOrigin, freshRsUser);
    const existing = 'Previously synced note';
    await capture(page, existing);
    await expect
      .poll(async () =>
        (await getInboxItems(freshRsUser, freshRsToken)).map(
          (item) => item.title,
        ),
      )
      .toContain(existing);

    const storage = `http://localhost:8000/storage/${freshRsUser.username}/**`;
    await page.route(storage, (route) =>
      route.fulfill({
        status,
        headers: { 'Access-Control-Allow-Origin': webOrigin },
        body: '',
      }),
    );
    const pending = `Pending note after rejection ${status}`;
    await capture(page, pending);
    const warning = page
      .getByRole('alert')
      .filter({ hasText: 'Reconnect your storage' });
    await expect(warning).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole('button', { name: 'User menu — reconnect required' }),
    ).toBeVisible();
    expect(
      (await getInboxItems(freshRsUser, freshRsToken)).map(
        (item) => item.title,
      ),
    ).not.toContain(pending);

    await page.reload();
    await expect(warning).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole('button', { name: `Open ${pending}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${existing}`, exact: true }),
    ).toBeVisible();
    await warning
      .getByRole('button', { name: 'Reconnect', exact: true })
      .click();
    await page.waitForURL(/^http:\/\/localhost:8000\/oauth\//);
    await page.unroute(storage);
    await allow(page, webOrigin, freshRsUser);
    await expect(warning).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await getInboxItems(freshRsUser, freshRsToken)).map(
            (item) => item.title,
          ),
        { timeout: 20_000 },
      )
      .toContain(pending);
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'User menu — connected' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open ${pending}`, exact: true }),
    ).toBeVisible();
    await expect(warning).toHaveCount(0);
  });
}

test('denying initial OAuth returns to a usable disconnected account form', async ({
  page,
  freshRsUser,
  webOrigin,
}) => {
  await beginConnect(page, webOrigin, freshRsUser);
  await page.locator('button[name="deny"]').click();
  await page.waitForURL(`${webOrigin}/**`);
  await expect(
    page.getByRole('button', { name: 'User menu — disconnected' }),
  ).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Reconnect your storage' }),
  ).toHaveCount(0);
  // A second attempt must work after the denied callback cleaned up auth.
  await beginConnect(page, webOrigin, freshRsUser);
  await allow(page, webOrigin, freshRsUser);
});

test('temporary server errors do not request reauthorization and queued writes recover', async ({
  page,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  test.setTimeout(60_000);
  await beginConnect(page, webOrigin, freshRsUser);
  await allow(page, webOrigin, freshRsUser);
  const storage = `http://localhost:8000/storage/${freshRsUser.username}/**`;
  await page.route(storage, (route) =>
    route.fulfill({
      status: 503,
      headers: { 'Access-Control-Allow-Origin': webOrigin },
      body: '',
    }),
  );
  const rejected = page.waitForResponse(
    (response) =>
      response.url().includes(`/storage/${freshRsUser.username}/`) &&
      response.status() === 503,
  );
  const title = 'Saved during temporary outage';
  await capture(page, title);
  await rejected;
  await expect(
    page.getByRole('alert').filter({ hasText: 'Reconnect your storage' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'User menu — connected' }),
  ).toBeVisible();
  await page.unroute(storage);
  await expect
    .poll(
      async () =>
        (await getInboxItems(freshRsUser, freshRsToken)).map(
          (item) => item.title,
        ),
      { timeout: 30_000 },
    )
    .toContain(title);
});

test('discovery failure lets the user correct the address and connect again', async ({
  page,
  freshRsUser,
  webOrigin,
}) => {
  await page.goto(webOrigin);
  await page.getByRole('button', { name: 'User menu — disconnected' }).click();
  await page.getByRole('button', { name: /^Account — Not connected/ }).click();
  await page.route('**/.well-known/webfinger?**', (route) =>
    route.fulfill({
      status: 503,
      headers: { 'Access-Control-Allow-Origin': webOrigin },
      body: '',
    }),
  );
  await page.getByPlaceholder('user@storage.example').fill(freshRsUser.address);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Connect', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Reconnect your storage' }),
  ).toHaveCount(0);
  await page.unroute('**/.well-known/webfinger?**');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForURL(/^http:\/\/localhost:8000\/oauth\//);
  await allow(page, webOrigin, freshRsUser);
});

test('denying reauthorization clears the stale account and reconnect warning', async ({
  page,
  freshRsUser,
  webOrigin,
}) => {
  test.setTimeout(60_000);
  await beginConnect(page, webOrigin, freshRsUser);
  await allow(page, webOrigin, freshRsUser);
  const storage = `http://localhost:8000/storage/${freshRsUser.username}/**`;
  await page.route(storage, (route) =>
    route.fulfill({
      status: 401,
      headers: { 'Access-Control-Allow-Origin': webOrigin },
      body: '',
    }),
  );
  await capture(page, 'Note before denying reauthorization');
  const warning = page
    .getByRole('alert')
    .filter({ hasText: 'Reconnect your storage' });
  await expect(warning).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole('button', { name: 'User menu — reconnect required' })
    .click();
  await page
    .getByRole('button', { name: /^Account — Reconnect required/ })
    .click();
  const account = page.getByRole('dialog');
  await expect(warning).toHaveCount(1);
  await expect(
    account
      .locator('#settings-account')
      .getByText(freshRsUser.address, { exact: true }),
  ).toBeVisible();
  await account.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await page.waitForURL(/^http:\/\/localhost:8000\/oauth\//);
  await page.unroute(storage);
  await page.locator('button[name="deny"]').click();
  await page.waitForURL(`${webOrigin}/**`);
  await expect(
    page.getByRole('button', { name: 'User menu — disconnected' }),
  ).toBeVisible();
  await expect(warning).toHaveCount(0);
  await page.getByRole('button', { name: 'User menu — disconnected' }).click();
  await page.getByRole('button', { name: /^Account — Not connected/ }).click();
  await expect(
    account.getByRole('textbox', { name: 'Storage address' }),
  ).toBeVisible();
  await expect(
    account.getByRole('button', { name: 'Connect', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'User menu — disconnected' }),
  ).toBeVisible();
  await expect(warning).toHaveCount(0);
});

test('a stale token restored at startup shows a reconnect warning', async ({
  page,
  context,
  freshRsUser,
  webOrigin,
}) => {
  // The actual server rejects this token; no injected RS events or HTTP mocks.
  await seedRsSession(context, freshRsUser, 'expired-token', {
    clientOrigin: webOrigin,
  });
  await page.goto(webOrigin);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Reconnect your storage' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'User menu — reconnect required' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Reconnect your storage' }),
  ).toBeVisible();
});

test('failed reconnect discovery keeps local data and allows retry', async ({
  page,
  freshRsUser,
  webOrigin,
}) => {
  test.setTimeout(60_000);
  await beginConnect(page, webOrigin, freshRsUser);
  await allow(page, webOrigin, freshRsUser);
  const storage = `http://localhost:8000/storage/${freshRsUser.username}/**`;
  await page.route(storage, (route) =>
    route.fulfill({
      status: 401,
      headers: { 'Access-Control-Allow-Origin': webOrigin },
      body: '',
    }),
  );
  const title = 'Local note during failed reconnect';
  await capture(page, title);
  const warning = page
    .getByRole('alert')
    .filter({ hasText: 'Reconnect your storage' });
  await expect(warning).toBeVisible({ timeout: 20_000 });
  await page.route('**/.well-known/webfinger?**', (route) =>
    route.fulfill({
      status: 503,
      headers: { 'Access-Control-Allow-Origin': webOrigin },
      body: '',
    }),
  );
  const failedDiscovery = page.waitForResponse(
    (response) =>
      response.url().includes('/.well-known/webfinger?') &&
      response.status() === 503,
  );
  await warning.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await failedDiscovery;
  await expect(warning).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Open ${title}`, exact: true }),
  ).toBeVisible();
  await page.unroute('**/.well-known/webfinger?**');
  await warning.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await page.waitForURL(/^http:\/\/localhost:8000\/oauth\//);
  await page.unroute(storage);
  await allow(page, webOrigin, freshRsUser);
  await expect(warning).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: `Open ${title}`, exact: true }),
  ).toBeVisible();
});

for (const outage of ['browser offline', 'storage unreachable']) {
  test(`${outage}: Account never presents failed requests as synced`, async ({
    page,
    freshRsUser,
    freshRsToken,
    webOrigin,
  }) => {
    test.setTimeout(60_000);
    await beginConnect(page, webOrigin, freshRsUser);
    await allow(page, webOrigin, freshRsUser);
    const storage = `http://localhost:8000/storage/${freshRsUser.username}/**`;
    const failedRequest = page.waitForEvent('requestfailed', (request) =>
      request.url().includes(`/storage/${freshRsUser.username}/`),
    );
    if (outage === 'browser offline') await page.context().setOffline(true);
    else await page.route(storage, (route) => route.abort('connectionfailed'));
    const title = `Queued note while ${outage}`;
    await capture(page, title);
    await failedRequest;
    const label =
      outage === 'browser offline' ? 'Offline' : 'Storage unreachable';
    await page
      .getByRole('button', {
        name: `User menu — ${label.toLowerCase()}`,
        exact: true,
      })
      .click();
    await page
      .getByRole('button', { name: new RegExp(`^Account — ${label}`) })
      .click();
    const status = page.locator('#settings-account .identity .pill');
    await expect(status).toHaveText(label);
    await expect(status).not.toHaveClass(/ok/);
    await expect(page.locator('.status-dot')).not.toHaveClass(
      /connected|syncing/,
    );
    if (outage === 'browser offline') await page.context().setOffline(false);
    else await page.unroute(storage);
    await expect
      .poll(
        async () =>
          (await getInboxItems(freshRsUser, freshRsToken)).map(
            (item) => item.title,
          ),
        { timeout: 30_000 },
      )
      .toContain(title);
    await expect(status).toHaveText('Connected');
    await expect(status).toHaveClass(/ok/);
  });
}

for (const callback of [
  '?error=access_denied',
  '#/search?q=notes&error=access_denied',
  '?error=server_error',
  '#remotestorage=attacker%40storage.invalid',
]) {
  test(`unsolicited callback ${callback} preserves session and queued changes`, async ({
    page,
    freshRsUser,
    freshRsToken,
    webOrigin,
  }) => {
    await beginConnect(page, webOrigin, freshRsUser);
    await allow(page, webOrigin, freshRsUser);
    const storage = `http://localhost:8000/storage/${freshRsUser.username}/**`;
    await page.route(storage, (route) => route.abort('connectionfailed'));
    const title = 'Unsynced note must survive an unsolicited callback';
    await capture(page, title);
    expect(
      (await getInboxItems(freshRsUser, freshRsToken)).map(
        (item) => item.title,
      ),
    ).not.toContain(title);
    await page.goto(`${webOrigin}/${callback}`);
    // Move back to the inbox if the crafted URL contained a search route.
    await page
      .getByRole('button', { name: 'Inbox', exact: true })
      .first()
      .click();
    await expect(
      page.getByRole('button', { name: `Open ${title}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'User menu — disconnected' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('alert').filter({ hasText: 'Reconnect your storage' }),
    ).toHaveCount(0);
    await page.unroute(storage);
    await expect
      .poll(
        async () =>
          (await getInboxItems(freshRsUser, freshRsToken)).map(
            (item) => item.title,
          ),
        { timeout: 20_000 },
      )
      .toContain(title);
  });
}

test('a denial with mismatched state cannot discard a pending reconnect draft', async ({
  page,
  freshRsUser,
  webOrigin,
}) => {
  await beginConnect(page, webOrigin, freshRsUser);
  await allow(page, webOrigin, freshRsUser);
  const storage = `http://localhost:8000/storage/${freshRsUser.username}/**`;
  await page.route(storage, (route) =>
    route.fulfill({
      status: 401,
      headers: { 'Access-Control-Allow-Origin': webOrigin },
      body: '',
    }),
  );
  const title = 'Draft protected from mismatched OAuth state';
  await capture(page, title);
  const warning = page
    .getByRole('alert')
    .filter({ hasText: 'Reconnect your storage' });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await page.waitForURL(/^http:\/\/localhost:8000\/oauth\//);
  const state = new URL(page.url()).searchParams.get('state');
  expect(state).toBeTruthy();
  await page.goto(`${webOrigin}/#error=access_denied&state=wrong-${state}`);
  await expect(
    page.getByRole('button', { name: `Open ${title}`, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: `Open ${title}`, exact: true }),
  ).toBeVisible();
});
