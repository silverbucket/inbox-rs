import { putInboxItem } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';

test('the compare sheet covers the tab bar, so "Keep this one" can be tapped', async ({
  connectedPage: page,
  webOrigin,
  rsUser,
  rsToken,
}) => {
  const body =
    'Ask the landlord about the heating schedule before winter, on a phone.';
  for (const id of ['dup-m1', 'dup-m2']) {
    await putInboxItem(rsUser, rsToken, {
      item: {
        id,
        type: 'note',
        title: 'Ask the landlord',
        body,
        createdAt: new Date().toISOString(),
      },
    });
  }
  await page.goto(webOrigin);
  await page
    .locator('[data-item-id="dup-m1"]')
    .getByRole('button', { name: /compare\?$/ })
    .tap();
  const keep = page
    .getByRole('dialog', { name: 'Two copies of the same card' })
    .getByRole('button', { name: 'Keep this one' })
    .first();
  await expect(keep).toBeVisible();
  // Hit-test the button: the tab bar must not sit on top of the sheet.
  const onTop = await keep.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return el.contains(hit);
  });
  expect(onTop).toBe(true);
  await keep.tap();
  await expect(page.locator('[data-item-id="dup-m2"]')).toHaveCount(0);
});
