/**
 * Settings → Your data reports the total bytes stored on the RS server.
 *
 * The number comes from the server's own folder descriptions
 * (`Content-Length` per document), not from anything the app has cached —
 * so the account is seeded straight onto Armadietto with a payload big
 * enough to dominate the total, and the row has to land on it.
 */

import { putInboxFile, putInboxItem } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

test('Your data shows the total size on the storage server', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  const id = 'usage-doc-1';
  const now = new Date().toISOString();
  // 3 MiB of file bytes; the item JSON alongside it is a few hundred bytes,
  // which rounds away at one decimal place.
  await putInboxFile(freshRsUser, freshRsToken, {
    path: `files/${id}.bin`,
    body: new Uint8Array(3 * 1024 * 1024),
    contentType: 'application/octet-stream',
  });
  await putInboxItem(freshRsUser, freshRsToken, {
    item: {
      id,
      type: 'document',
      title: 'Usage fixture',
      filePath: `files/${id}.bin`,
      mimeType: 'application/octet-stream',
      createdAt: now,
      updatedAt: now,
    },
  });

  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const page = await context.newPage();
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  await page.keyboard.press('ControlOrMeta+,');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: /^Your data/ }).click();

  await expect(settings.getByTestId('storage-usage')).toHaveText('3.0 MB', {
    timeout: 10_000,
  });
  // Svelte trims whitespace at block edges — the separator must survive it.
  await expect(
    settings.getByText('1 items · 3.0 MB on your storage server'),
  ).toBeVisible();
});
