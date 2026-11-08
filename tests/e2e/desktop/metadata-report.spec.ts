import { putInboxItem } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';

test('incomplete previews offer an editable upstream issue without private notes or URL tokens', async ({
  connectedPage,
  webOrigin,
  rsUser,
  rsToken,
}) => {
  const url =
    'https://metadata-report.invalid/article?token=private-token#private';
  await putInboxItem(rsUser, rsToken, {
    item: {
      id: 'metadata-report',
      type: 'bookmark',
      title: url,
      url,
      body: 'Private bookmark notes\n'.repeat(100),
      createdAt: new Date().toISOString(),
    },
  });
  await connectedPage.goto(webOrigin);
  const card = connectedPage.locator('[data-item-id="metadata-report"]');
  const link = card.getByRole('link', {
    name: 'Report preview issue (public) ↗',
    exact: true,
  });
  await expect(link).toBeVisible();
  const issue = new URL((await link.getAttribute('href')) ?? '');
  expect(issue.origin + issue.pathname).toBe(
    'https://github.com/sockethub/sockethub/issues/new',
  );
  expect(issue.searchParams.get('body')).toContain(
    'https://metadata-report.invalid/article',
  );
  expect(issue.searchParams.get('body')).not.toContain('private-token');
  expect(issue.searchParams.get('body')).not.toContain(
    'Private bookmark notes',
  );
  await connectedPage.setViewportSize({ width: 390, height: 844 });
  await card.locator('.card-select').press('Enter');
  const detailReport = connectedPage.getByRole('link', {
    name: 'Report preview issue to Sockethub ↗',
    exact: true,
  });
  await expect(detailReport).toBeVisible();
  const reportBox = await detailReport.boundingBox();
  expect(
    reportBox?.y ?? Infinity,
    'report action stays above long notes on a phone',
  ).toBeLessThan(422);
  const modal = connectedPage.locator('.modal').first();
  await expect
    .poll(() => modal.evaluate((el) => el.scrollHeight))
    .toBeGreaterThan(844);
  await modal.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const file = connectedPage.getByRole('button', {
    name: 'File into collection…',
    exact: true,
  });
  const fileBox = await file.boundingBox();
  expect(fileBox?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect(
    fileBox?.y ?? Infinity,
    'filing remains reachable while reading the end of a long item',
  ).toBeLessThan(200);
  await file.click();
  await expect(
    connectedPage.getByRole('dialog', {
      name: 'File into collection',
      exact: true,
    }),
  ).toBeVisible();
});
