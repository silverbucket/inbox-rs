import { defineConfig, devices } from '@playwright/test';

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:4173';

/**
 * Playwright config for the inbox-rs PWA e2e suite.
 *
 * Two project profiles ride on the same chromium binary:
 *
 * - `desktop-chromium` — 1440×900 viewport, no touch, runs every spec
 *   under `desktop/`.
 * - `mobile-chromium` — Pixel-5 device emulation (393×851 logical, 2.75
 *   DPR, has-touch, mobile UA), runs every spec under `mobile/`. The
 *   small viewport trips the 768 px breakpoint in `App.svelte`, which is
 *   the whole point.
 *
 * `webServer` boots a local Armadietto remoteStorage server (Docker
 *  Compose) and a `vite preview` of the production-built web app before
 * any test runs. Both shut down cleanly on exit. We test the production
 * preview rather than the dev server because PWA behaviour (manifest,
 * asset paths, build-time defines) only matches reality after `vite build`.
 *
 * Workers are pinned to 1 — multiple workers would race each other on
 * the shared per-worker Armadietto user fixture. The whole suite runs in
 * ~25 s on a developer laptop, so the parallelism gain isn't worth the
 * fixture complexity.
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['desktop/*.spec.ts', 'mobile/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Default actionability timeouts. Individual tests can override per call
    // for the genuinely-slow waits (sync round-trips, OAuth redirects).
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      testDir: './desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-chromium',
      testDir: './mobile',
      use: {
        // Pixel 5 ships with viewport 393×851, DPR 2.75, hasTouch, isMobile,
        // and a real Android Chrome UA — exactly the profile our manual
        // mobile checks use, so we lift it wholesale.
        ...devices['Pixel 5'],
      },
    },
  ],
  webServer: [
    {
      // Foreground compose — Compose forwards SIGTERM to the container so
      // Playwright's teardown leaves nothing running.
      command: 'docker compose up armadietto',
      url: 'http://localhost:8000/',
      cwd: '../..',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run preview -w packages/web -- --port 4173 --strictPort',
      url: WEB_ORIGIN,
      cwd: '../..',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
