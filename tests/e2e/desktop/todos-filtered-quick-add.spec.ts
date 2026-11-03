/**
 * A quick-added todo never vanishes from the filtered Todos page.
 *
 * Reproduces the original complaint: file a todo into a collection from the
 * Todos page, hide that collection's group, type another todo, press Enter.
 * The composer used to keep pointing at the now-hidden collection, so the
 * new todo was filed out of view and disappeared on Enter. The destination
 * must instead follow the filter, and a deliberate pick of a hidden
 * collection must keep the row listed rather than dropping it.
 */

import { expect, test } from '../helpers/fixtures';
import {
  assertNoConsoleErrors,
  attachConsoleCapture,
  seedRsSession,
} from '../helpers/pwa';

test('the composer follows the group filter, and hidden picks stay listed', async ({
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

  // Two groups, one collection each, created through the sidebar.
  await page.goto(`${webOrigin}/#/collections`);
  await page.waitForLoadState('networkidle');
  for (const [group, collection] of [
    ['Work', 'Reports'],
    ['Home', 'Garden'],
  ] as const) {
    await page
      .getByRole('button', { name: /New group|Create your first group/ })
      .first()
      .click();
    await page.getByPlaceholder('Name a group…').fill(group);
    await page.keyboard.press('Enter');
    await page
      .getByRole('button', { name: `Add collection to ${group}` })
      .first()
      .click();
    await page.getByPlaceholder('Name a collection…').fill(collection);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
  }

  await page.goto(`${webOrigin}/#/todos`);
  await page.waitForLoadState('networkidle');
  const input = page.getByLabel('Todo title');
  const chip = page.getByRole('button', { name: /File into collection/ });
  const picker = page.getByRole('dialog');

  // File one todo into Garden so Garden becomes the remembered destination.
  await chip.click();
  await picker.getByRole('button', { name: /^Garden/ }).click();
  await input.fill('Plant tulips');
  await input.press('Enter');
  await expect(page.getByText('Plant tulips')).toBeVisible({ timeout: 10_000 });
  await expect(chip).toContainText('Garden');

  // Hide Home. The chip must leave Garden for a collection still in view.
  await page.getByRole('button', { name: /^Home \d/ }).click();
  await expect(page.getByText('Plant tulips')).not.toBeVisible();
  await expect(chip).toContainText('Reports');

  // Plain Enter now lands in the list the user is looking at.
  await input.fill('Write Q4 summary');
  await input.press('Enter');
  const summary = page
    .getByRole('listitem')
    .filter({ hasText: 'Write Q4 summary' });
  await expect(summary).toBeVisible({ timeout: 10_000 });
  await expect(summary).toContainText('Reports');

  // Hidden collections are still reachable, but sectioned off, and a todo
  // filed there on purpose stays in the list instead of vanishing.
  await chip.click();
  await expect(picker.getByText('Hidden by your filter')).toBeVisible();
  await picker.getByRole('button', { name: /^Garden/ }).click();
  await expect(chip).toHaveAttribute('aria-label', /hidden by your filter/);
  await input.fill('Water the beds');
  await input.press('Enter');
  const beds = page.getByRole('listitem').filter({ hasText: 'Water the beds' });
  await expect(beds).toBeVisible({ timeout: 10_000 });
  await expect(beds).toContainText('Garden');

  // Changing the filter hands the list back to the filter: the deliberate
  // Garden todo goes with its group, and the explicit pick is forgotten.
  // Show Home: Garden is in view again, so the chip returns to the
  // remembered Garden and the row stays on its own merits. Wait for that
  // before hiding Home again — two back-to-back toggles race each other's
  // config write.
  await page.getByRole('button', { name: /^Home \d/ }).click();
  await expect(chip).toContainText('Garden');
  await page.getByRole('button', { name: /^Home \d/ }).click();
  await expect(beds).not.toBeVisible();
  await expect(chip).toContainText('Reports');

  // Filing a quick-added todo PUTs the item twice in quick succession
  // (create, then move), and remoteStorage.js sometimes sends the second
  // with a stale ETag — a 412 the sync layer retries. It predates this
  // feature (reproducible on master) and is not what this spec guards.
  assertNoConsoleErrors(log.filter((m) => !m.includes('status of 412')));
});
