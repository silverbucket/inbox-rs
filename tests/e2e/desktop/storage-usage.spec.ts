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

/** Seed a document item backed by `mib` MiB of file bytes. */
async function seedDocument(
  user: string,
  token: string,
  id: string,
  mib: number,
) {
  const now = new Date().toISOString();
  await putInboxFile(user, token, {
    path: `files/${id}.bin`,
    body: new Uint8Array(mib * 1024 * 1024),
    contentType: 'application/octet-stream',
  });
  await putInboxItem(user, token, {
    item: {
      id,
      type: 'document',
      title: `Usage fixture ${id}`,
      filePath: `files/${id}.bin`,
      mimeType: 'application/octet-stream',
      createdAt: now,
      updatedAt: now,
    },
  });
}

test('Your data shows the total size on the storage server', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  // 3 MiB of file bytes; the item JSON alongside it is a few hundred bytes,
  // which rounds away at one decimal place.
  await seedDocument(freshRsUser, freshRsToken, 'usage-doc-1', 3);

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
    settings.getByText(
      '1 items · 3.0 MB in your inbox, on your storage server',
    ),
  ).toBeVisible();
});

test('the total follows the server while the section stays open', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  await seedDocument(freshRsUser, freshRsToken, 'usage-doc-1', 3);

  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const page = await context.newPage();
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  await page.keyboard.press('ControlOrMeta+,');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: /^Your data/ }).click();
  const usage = settings.getByTestId('storage-usage');
  await expect(usage).toHaveText('3.0 MB', { timeout: 10_000 });

  // More bytes land on the server (a restore, another device). The figure
  // is re-read when the next sync settles — no reopening the section.
  await seedDocument(freshRsUser, freshRsToken, 'usage-doc-2', 2);
  await expect(usage).toHaveText('5.0 MB', { timeout: 30_000 });
});
