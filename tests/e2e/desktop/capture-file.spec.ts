/**
 * The capture bar's ⊕ ("Attach a file") button lets the user pick a file.
 * Choosing an image triggers the `onfile` path in App.svelte: `handleFile`
 * sets `activeModal = 'image'` and passes `prefillFile` to AddEntryModal,
 * which forwards it to ImageForm.  ImageForm renders the filename in a
 * `.picked` span and makes the form submittable.
 *
 * The native file dialog cannot be driven by Playwright, so we bypass the ⊕
 * button and call `setInputFiles` directly on the hidden `.file-input` input.
 * This fires the `change` event that CaptureBar's `onFileChange` listens to,
 * which calls `onfile(file)` — exactly the path the button would trigger.
 */

import { expect, test } from '../helpers/fixtures';
import { assertNoConsoleErrors, attachConsoleCapture } from '../helpers/pwa';

test('attaching an image via the capture bar opens the Add Image modal with the filename pre-filled', async ({
  connectedPage,
  webOrigin,
}) => {
  const log = attachConsoleCapture(connectedPage);
  await connectedPage.goto(webOrigin);
  await connectedPage.waitForLoadState('networkidle');

  // Make sure we're on the inbox view — that's the only page that renders the
  // desktop CaptureBar (and therefore the hidden .file-input).
  await connectedPage.getByRole('button', { name: 'Inbox' }).first().click();

  // Build a minimal valid 1×1 PNG in memory so we never need a real file on
  // disk.  The bytes are the standard 67-byte 1×1 transparent PNG.
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const fileName = 'playwright-test-image.png';

  // Set the file directly on the hidden input — this fires the `change` event
  // that CaptureBar wires to `onFileChange` → `onfile(file)`.  We do NOT click
  // the ⊕ button because that would open a real OS dialog.
  const fileInput = connectedPage.locator('.file-input');
  await fileInput.setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: pngBuffer,
  });

  // App.svelte#handleFile detects `image/png` and sets activeModal = 'image',
  // which causes AddEntryModal to render with role="dialog" and heading "Add Image".
  const dialog = connectedPage.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(
    connectedPage.getByRole('heading', { name: 'Add Image' }),
  ).toBeVisible({ timeout: 10_000 });

  // ImageForm pre-fills the file and renders the filename in a .picked span.
  const picked = connectedPage.locator('.picked');
  await expect(picked).toBeVisible({ timeout: 10_000 });
  await expect(picked).toHaveText(fileName);

  assertNoConsoleErrors(log);
});
