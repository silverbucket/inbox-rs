/**
 * Migration save-gate regression test (issue #80).
 *
 * `inbox.runAllMigrations()` delegates to `rs-migrate@1.0.2`'s
 * `migrateAll`, which gates `save` on a JSON-equality check after
 * stripping `_migrateVersion`. Pre-1.0.2 the gate was reference equality
 * after a `structuredClone`, so every doc behind the latest version got
 * re-saved on Migrate — including docs whose pending transforms produced
 * no real content change.
 *
 * This spec seeds two docs that exercise both branches of the new gate:
 *
 * - **`legacy-voice-memo`** — type `voice-memo`, no `_migrateVersion`.
 *   Pending v1 transform rewrites `type` → `audio`, real content change
 *   ⇒ exactly 1 PUT expected.
 * - **`stale-note`** — type `note`, stamped at `_migrateVersion: 1`.
 *   Pending v2 (no-op) and v3 (only touches `code-snippet`) leave content
 *   identical apart from the version field ⇒ 0 PUTs expected.
 *
 * Pre-fix this would record 2 PUTs; post-fix it records 1. The dry-run
 * helper from PR #79 (`requiresContentMigration` in `stores.ts`) keeps the
 * stale-note out of the migration alert count, so the alert displays
 * "1 item needs to be migrated" — that's the cue we wait on before
 * clicking Migrate.
 *
 * Uses `freshRsUser` / `freshRsToken` (per-test) rather than the shared
 * worker user so we can assert on a known-empty starting state.
 */

import type { InboxItem } from '@inbox-rs/rs-module';
import { putInboxItem } from '../helpers/armadietto';
import { expect, test } from '../helpers/fixtures';
import { seedRsSession } from '../helpers/pwa';

test('Migrate writes only docs whose content actually changes', async ({
  context,
  freshRsUser,
  freshRsToken,
  webOrigin,
}) => {
  // Doc 1: legacy voice-memo. v1 transform rewrites type → audio. The
  // `voice-memo` literal isn't in `InboxItemType` (current-types only),
  // so we cast through `unknown` the same way the unit-test fixtures do
  // (see packages/web/src/lib/stores.test.ts:310-318).
  await putInboxItem(freshRsUser, freshRsToken, {
    item: {
      id: 'legacy-voice-memo-1',
      type: 'voice-memo',
      title: 'Legacy memo',
      filePath: 'files/legacy-voice-memo-1.m4a',
      mimeType: 'audio/mp4',
      createdAt: '2024-01-01T00:00:00.000Z',
    } as unknown as InboxItem,
  });

  // Doc 2: note already at v1. The v2 transform is `(d) => d` and v3
  // only touches `code-snippet`, so neither changes content for a note —
  // only `_migrateVersion` would shift. The new save gate must skip
  // this PUT entirely.
  await putInboxItem(freshRsUser, freshRsToken, {
    item: {
      id: 'stale-note-1',
      type: 'note',
      title: 'Already-current note',
      body: 'unchanged content',
      createdAt: '2024-01-01T00:00:00.000Z',
      _migrateVersion: 1,
    },
  });

  await seedRsSession(context, freshRsUser, freshRsToken, {
    clientOrigin: webOrigin,
  });
  const page = await context.newPage();

  // Attach the request listener before navigation. Migrate fires its
  // PUTs synchronously after click() resolves the runAllMigrations
  // promise; if we attached after waiting on the alert we'd race.
  const itemPuts: string[] = [];
  page.on('request', (req) => {
    if (
      req.method() === 'PUT' &&
      req.url().includes(`/storage/${freshRsUser.username}/inbox/items/`)
    ) {
      itemPuts.push(req.url());
    }
  });

  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  // The migration alert surfaces once `migrationAlertReady` flips on
  // sync-done (or after the 2.5 s fallback in
  // packages/web/src/lib/stores.ts:52). The dry-run filter keeps
  // `stale-note` out of the count, so the alert reports 1, not 2.
  const alert = page
    .getByRole('alert')
    .filter({ hasText: 'Data migration available' });
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).toContainText('1 item needs to be migrated');

  // Drop any stray PUTs from initial sync. The seed docs themselves
  // shouldn't trigger any (rs-module's getAll only stamps _migrateVersion
  // in memory, never persists), but resetting here makes the post-Migrate
  // assertion unambiguous about what `runAllMigrations` itself produced.
  itemPuts.length = 0;

  // The button's accessible name flips between "Migrate" and
  // "Migrating..." while running, so anchor on the stable class.
  await page.locator('button.btn-migrate').click();

  // Alert disappears once `runAllMigrations` resolves and `loadItems`
  // re-runs: the voice-memo is now `audio` at the latest version, the
  // stale note is still at v1 in storage but filtered out by the
  // dry-run helper. `count(0)` is the cleanest "alert gone" assertion.
  await expect(alert).toHaveCount(0, { timeout: 15_000 });
  // Drain any in-flight requests before counting — the click resolves
  // before remoteStorage.js batches the PUT in some sync timings.
  await page.waitForLoadState('networkidle');

  // The crux of the regression test: exactly one PUT, for the voice-memo
  // path. Pre-rs-migrate@1.0.2 this was 2.
  expect(itemPuts).toHaveLength(1);
  expect(itemPuts[0]).toContain('/inbox/items/legacy-voice-memo-1');
});
