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
      body: 'Private bookmark notes',
      createdAt: new Date().toISOString(),
    },
  });
  await connectedPage.goto(webOrigin);
  const card = connectedPage.locator('[data-item-id="metadata-report"]');
  const link = card.getByRole('link', {
    name: 'Report preview issue ↗',
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
  await card.locator('.card-select').click();
  await expect(
    connectedPage.getByRole('link', {
      name: 'Report preview issue to Sockethub ↗',
      exact: true,
    }),
  ).toBeVisible();
});
