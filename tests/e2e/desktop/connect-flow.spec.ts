/**
 * Connect / disconnect against the local Armadietto.
 *
 * The connect widget lives inside `UserMenu.svelte`. We type the address
 * into the form, submit, and let `remotestoragejs` redirect through
 * Armadietto's Allow page. The test user already exists (signup happens
 * in the worker fixture) so the OAuth screen needs only the password.
 */

import { expect, test } from '../helpers/fixtures';
import { attachConsoleCapture } from '../helpers/pwa';

test('full connect round-trip via OAuth', async ({
  page,
  webOrigin,
  rsUser,
}) => {
  // Drive the disconnected → connected transition end-to-end through
  // the real OAuth UI, not the seeded-token shortcut. This is the closest
  // we get to a 'first time user' acceptance test.
  attachConsoleCapture(page);
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  // Open the user menu (header right). It's labelled by aria-label, not
  // visible text, when disconnected.
  await page.getByRole('button', { name: 'User menu — disconnected' }).click();

  // Type the RS address and submit. The form's submit button reads
  // "Connect" until in-flight, then "Connecting…".
  await page.getByPlaceholder('user@storage.example').fill(rsUser.address);
  // `exact: true` so we don't accidentally select the User-menu trigger
  // button, whose accessible name contains the substring "Connect".
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  // remotestoragejs navigates to Armadietto's /oauth/<user> page. Wait
  // for the URL to flip to localhost:8000 so we know the redirect fired.
  await page.waitForURL(/^http:\/\/localhost:8000\/oauth\//, {
    timeout: 10_000,
  });

  // Armadietto's Allow form: type password and click Allow.
  await page.locator('input[name="password"]').fill(rsUser.password);
  await page.locator('button[name="allow"]').click();

  // Should land back on the web app with #access_token=… in the hash.
  await page.waitForURL(`${webOrigin}/**`, { timeout: 10_000 });
  await page.waitForLoadState('networkidle');

  // The disconnected empty-state CTA is gone, the user menu's connected
  // aria-label is in place. Use the aria-label as the assertion target since
  // the avatar text is the user's initials and not stable across runs.
  await expect(
    page.getByRole('button', { name: 'Connect to your remoteStorage' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'User menu — connected' }),
  ).toBeVisible();
});

test('disconnect returns to empty state', async ({
  connectedPage,
  webOrigin,
}) => {
  // Once connected, the menu shows a Disconnect entry. Clicking it must
  // reset the UI to the disconnected empty state — InboxGrid's
  // "Connect to your remoteStorage" CTA is the marker.
  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');

  await expect(
    connectedPage.getByRole('button', { name: 'User menu — connected' }),
  ).toBeVisible();

  await connectedPage
    .getByRole('button', { name: 'User menu — connected' })
    .click();
  await connectedPage.getByRole('menuitem', { name: 'Disconnect' }).click();

  await expect(
    connectedPage.getByRole('button', {
      name: 'Connect to your remoteStorage',
    }),
  ).toBeVisible();
});
