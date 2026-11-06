/**
 * The Todos composer remembers the last collection picked (#279 depends on
 * it), so the chip must make that obvious and easy to undo: a remembered
 * collection is marked on the chip, and a ✕ next to it goes back to Unfiled.
 */

import { expect, test } from '../helpers/fixtures';
import {
  assertNoConsoleErrors,
  attachConsoleCapture,
  seedRsSession,
} from '../helpers/pwa';

test('a remembered collection is marked on the chip and one click clears it', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const page = await context.newPage();
  const log = attachConsoleCapture(page);

  await page.goto(`${webOrigin}/#/collections`);
  await page.waitForLoadState('networkidle');
  await page
    .getByRole('button', { name: /New group|Create your first group/ })
    .first()
    .click();
  await page.getByPlaceholder('Name a group…').fill('Home');
  await page.keyboard.press('Enter');
  // Two collections: with only one in view the rule always picks it.
  for (const name of ['Garden', 'Kitchen']) {
    await page
      .getByRole('button', { name: 'Add collection to Home' })
      .first()
      .click();
    await page.getByPlaceholder('Name a collection…').fill(name);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
  }

  await page.goto(`${webOrigin}/#/todos`);
  await page.waitForLoadState('networkidle');
  const input = page.getByLabel('Todo title');
  const chip = page.getByRole('button', { name: /File into collection/ });
  const clear = page.getByRole('button', { name: /Clear collection/ });

  // Unfiled: nothing to clear.
  await expect(chip).toContainText('Unfiled');
  await expect(clear).toHaveCount(0);

  await chip.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Garden/ })
    .click();
  await input.fill('Plant tulips');
  await input.press('Enter');
  await expect(page.getByText('Plant tulips')).toBeVisible({ timeout: 10_000 });

  // The pick sticks for the next todo, and the chip says so.
  await expect(chip).toContainText('Garden');
  await expect(chip).toHaveAccessibleName(/adding to Garden/);
  await expect(clear).toBeVisible();

  await clear.click();
  await expect(chip).toContainText('Unfiled');
  await expect(clear).toHaveCount(0);
  await expect(input).toBeFocused();

  // Cleared for good: still Unfiled after a reload.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(chip).toContainText('Unfiled');

  assertNoConsoleErrors(log);
});
