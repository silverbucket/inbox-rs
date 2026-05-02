/**
 * Regression: the Todos quick-add composer must render and save.
 *
 * History: a biome lint pass renamed `focusOnMount` to `_focusOnMount`
 * (biome's "intentionally unused" convention) without updating the
 * `use:focusOnMount` action reference in the template. The result: the
 * input mount threw `ReferenceError: focusOnMount is not defined`, the
 * whole `quickAddComposer` snippet failed to render, and the user could
 * neither see nor use the form. The empty-state path was the only way
 * to capture a first todo, so brand-new and mobile users were stuck.
 *
 * This test exercises the full path — render → type → submit → see —
 * so any future rename, action-binding break, or save-flow regression
 * fails here loudly instead of in production.
 */

import { expect, test } from '../helpers/fixtures';
import { assertNoConsoleErrors, attachConsoleCapture } from '../helpers/pwa';

test('quick-add composer captures a todo from the empty state', async ({
  connectedPage,
  webOrigin,
}) => {
  const log = attachConsoleCapture(connectedPage);
  await connectedPage.goto(`${webOrigin}/#/todos`);
  await connectedPage.waitForLoadState('networkidle');

  // Empty-state hero variant — the placeholder differs from the compact
  // (above-list) variant, so this also asserts which branch rendered.
  const input = connectedPage.getByPlaceholder('What needs doing?');
  await expect(input).toBeVisible();

  // The action-binding bug manifested as the input never auto-focusing
  // (and, in fact, the whole snippet failing to mount). Asserting focus
  // is the cheapest signal that `use:focusOnMount` actually fired.
  await expect(input).toBeFocused();

  const sentinel = 'playwright-quick-add-α';
  await input.fill(sentinel);

  // Form submission via Enter exercises the `onsubmit` handler, which is
  // the same code path the visible "Add" button rides.
  await input.press('Enter');

  // The todo row carries the title text. Wait long enough for the RS
  // round-trip; everything before this is in-memory but `storeItem` does
  // an actual remote PUT.
  await expect(connectedPage.getByText(sentinel)).toBeVisible({
    timeout: 10_000,
  });

  assertNoConsoleErrors(log);
});
