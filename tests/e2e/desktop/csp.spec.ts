/**
 * Content Security Policy (#74): both HTML shells ship the same policy, and
 * the browser enforces it — inline script stays blocked. Every other spec
 * fails on any CSP violation (the `cspGuard` fixture), which is what proves
 * the policy doesn't break the flows they drive.
 */

import { expect, test } from '../helpers/fixtures';

test.use({ allowCspViolations: true });

const policyOf = (page: import('@playwright/test').Page) =>
  page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');

for (const path of ['/', '/capture/']) {
  test(`${path} enforces the CSP and blocks inline script`, async ({
    page,
  }) => {
    await page.goto(path);
    const policy = await policyOf(page);
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(policy).toContain("object-src 'none'");

    const result = await page.evaluate(
      () =>
        new Promise<{ ran: boolean; directive: string }>((resolve) => {
          const w = window as unknown as { __cspInlineRan?: boolean };
          document.addEventListener(
            'securitypolicyviolation',
            (e) =>
              resolve({
                ran: !!w.__cspInlineRan,
                directive: e.effectiveDirective,
              }),
            { once: true },
          );
          const s = document.createElement('script');
          s.textContent = 'window.__cspInlineRan = true';
          document.head.appendChild(s);
        }),
    );
    expect(result).toEqual({ ran: false, directive: 'script-src-elem' });

    // The app itself still booted under the policy.
    await expect(page.locator('[data-app-loader]')).toHaveCount(0);
  });
}

test('main and capture shells carry the same policy', async ({ page }) => {
  await page.goto('/');
  const main = await policyOf(page);
  await page.goto('/capture/');
  expect(await policyOf(page)).toBe(main);
});
