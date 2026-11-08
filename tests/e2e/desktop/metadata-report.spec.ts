import { putInboxItem } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';

test('long detail titles wrap completely on phones and desktop', async ({
  connectedPage,
  webOrigin,
  rsUser,
  rsToken,
}) => {
  const title =
    'GitHub — a detailed reference about collecting ideas, organizing useful links, and keeping a clear plan for the projects that matter most';
  await putInboxItem(rsUser, rsToken, {
    item: {
      id: 'long-title',
      type: 'bookmark',
      title,
      url: 'https://example.com/reference',
      description: 'A complete preview.',
      createdAt: new Date().toISOString(),
    },
  });
  await connectedPage.goto(webOrigin);
  await connectedPage
    .locator('[data-item-id="long-title"] .card-select')
    .press('Enter');
  const field = connectedPage.getByRole('textbox', {
    name: 'Title',
    exact: true,
  });
  for (const width of [390, 1280]) {
    await connectedPage.setViewportSize({ width, height: 844 });
    await expect(field).toHaveValue(title);
    await expect
      .poll(() =>
        field.evaluate(
          (el) =>
            el.scrollWidth <= el.clientWidth + 1 &&
            el.scrollHeight <= el.clientHeight + 2,
        ),
      )
      .toBe(true);
    if (width === 390) {
      const titleBox = await field.boundingBox();
      const linkBox = await connectedPage
        .getByRole('link', { name: 'Open link ↗', exact: true })
        .boundingBox();
      if (!titleBox || !linkBox)
        throw new Error('Title and source link must be visible');
      expect(linkBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
    }
  }
  await connectedPage.setViewportSize({ width: 844, height: 260 });
  await connectedPage
    .locator('.modal')
    .first()
    .evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
  await connectedPage
    .getByRole('button', { name: 'Card actions', exact: true })
    .click();
  const deletion = connectedPage.getByRole('menuitem', {
    name: 'Delete card',
    exact: true,
  });
  await deletion.scrollIntoViewIfNeeded();
  await deletion.click();
  await expect(
    connectedPage.getByText('Delete permanently? This can’t be undone.'),
  ).toBeVisible();
});

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
  const link = card.getByRole('button', {
    name: 'Report preview issue (public) ↗',
    exact: true,
  });
  await expect(link).toBeVisible();
  await connectedPage.evaluate(() => {
    window.open = ((url: string | URL) => {
      (window as unknown as { reportDraft: string }).reportDraft = String(url);
      return null;
    }) as typeof window.open;
  });
  connectedPage.once('dialog', (dialog) =>
    dialog.accept('https://public-report.example/reproduce'),
  );
  await link.click();
  const issue = new URL(
    await connectedPage.evaluate(
      () => (window as unknown as { reportDraft: string }).reportDraft,
    ),
  );
  expect(issue.origin + issue.pathname).toBe(
    'https://github.com/sockethub/sockethub/issues/new',
  );
  expect(issue.searchParams.get('body')).toContain(
    'https://public-report.example/reproduce',
  );
  expect(issue.href).not.toContain('metadata-report.invalid');
  expect(issue.searchParams.get('body')).not.toContain('private-token');
  expect(issue.searchParams.get('body')).not.toContain(
    'Private bookmark notes',
  );
  await connectedPage.setViewportSize({ width: 390, height: 844 });
  await card.locator('.card-select').press('Enter');
  const detailReport = connectedPage.getByRole('button', {
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
