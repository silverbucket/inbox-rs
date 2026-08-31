/**
 * Mobile PWA-specific concerns: theme color, safe-area insets, dark mode.
 */

import { expect, test } from '../helpers/fixtures';

const PICK_ACTIVE_THEME_COLOR = () => {
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  for (const m of metas) {
    const media = m.getAttribute('media');
    if (!media) continue;
    if (window.matchMedia(media).matches) return m.getAttribute('content');
  }
  // Fall back to the unscoped one
  const fallback = document.querySelector(
    'meta[name="theme-color"]:not([media])',
  );
  return fallback ? fallback.getAttribute('content') : null;
};

test('dark color scheme picks the dark theme color', async ({
  page,
  webOrigin,
}) => {
  // The HTML declares two media-scoped theme-color metas. iOS Safari
  // picks the matching one for the status bar tint. Verify the dark
  // variant is the one Chrome's media query picks under
  // prefers-color-scheme: dark — what mobile devices on auto-dark land
  // on at night.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  // Pick the *active* theme-color via window.matchMedia instead of
  // parsing the HTML — that's how the browser would pick.
  const activeColor = await page.evaluate(PICK_ACTIVE_THEME_COLOR);
  expect(
    activeColor,
    'no theme-color meta resolved for dark scheme',
  ).toBeTruthy();
  expect(
    activeColor?.toLowerCase(),
    `Dark theme-color should be #002b36 (matches the dark bg), got ${activeColor}`,
  ).toBe('#002b36');
});

test('light color scheme picks the light theme color', async ({
  page,
  webOrigin,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(webOrigin);
  await page.waitForLoadState('networkidle');

  const activeColor = await page.evaluate(PICK_ACTIVE_THEME_COLOR);
  expect(
    activeColor,
    'no theme-color meta resolved for light scheme',
  ).toBeTruthy();
  expect(
    activeColor?.toLowerCase(),
    `Light theme-color should be #f6efdc, got ${activeColor}`,
  ).toBe('#f6efdc');
});
