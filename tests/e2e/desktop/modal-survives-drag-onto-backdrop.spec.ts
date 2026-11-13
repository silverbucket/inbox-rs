/**
 * Regression: selecting text in a modal must not close the modal.
 *
 * Modals close when their dimmed backdrop is clicked. A drag that starts in
 * a text field and overshoots the edge of the modal before the button is
 * released also produces a `click` on the backdrop (the common ancestor of
 * where the press began and ended), so sweeping across a title to replace it
 * closed the modal and threw the typing away.
 *
 * Driven with real mouse input on the dialog from the report — a board's
 * "New column set" — because a synthetic click has no press to stray from.
 * The second half pins that a deliberate click on the backdrop still closes.
 *
 * Runs in its own account: the collection and group it creates would
 * otherwise skew specs that count groups in the shared worker account.
 */

import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

test('dragging a text selection off a modal leaves it open; clicking the backdrop still closes it', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const page = await context.newPage();
  const stamp = Date.now();
  const collection = `Drag ${stamp}`;

  await page.goto(`${webOrigin}/#/collections`);
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'New collection' }).first().click();
  await page.getByPlaceholder('e.g. Reading List').fill(collection);
  const newGroup = page.getByPlaceholder('e.g. Personal');
  if (await newGroup.isVisible()) await newGroup.fill(`Group ${stamp}`);
  await page.keyboard.press('Enter');

  await page.getByRole('button', { name: `Focus on ${collection}` }).click();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await page.getByRole('button', { name: 'New column set…' }).click();

  const dialog = page.getByRole('dialog', { name: 'New column set' });
  const name = page.locator('#set-name');
  await name.fill('My own stages');

  const field = await name.boundingBox();
  const sheet = await dialog.boundingBox();
  if (!field || !sheet) throw new Error('dialog not laid out');
  const y = field.y + field.height / 2;
  // Just outside the dialog's left edge: on the backdrop.
  const outside = { x: sheet.x - 40, y };
  expect(outside.x).toBeGreaterThan(0);

  // Sweep from the end of the text leftwards, past the edge of the dialog.
  await page.mouse.move(field.x + field.width - 8, y);
  await page.mouse.down();
  await page.mouse.move(field.x + 8, y, { steps: 4 });
  await page.mouse.move(outside.x, outside.y, { steps: 4 });
  await page.mouse.up();

  // Give a close a chance to happen before asserting that it didn't.
  await page.waitForTimeout(200);
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue('My own stages');

  // The reverse drag — press on the backdrop, release in the dialog — is
  // not a dismissal either.
  await page.mouse.move(outside.x, outside.y);
  await page.mouse.down();
  await page.mouse.move(field.x + 8, y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await expect(dialog).toBeVisible();

  // A deliberate click on the backdrop still closes.
  await page.mouse.click(outside.x, outside.y);
  await expect(dialog).not.toBeVisible();
});
