import { defineConfig, devices } from '@playwright/test';

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:4173';

/** Playwright config for recording demo videos (no webServer — reuse running servers). */
export default defineConfig({
  testDir: '.',
  testMatch: ['demo/*.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: 'list',
  outputDir: '/opt/cursor/artifacts/demo/playwright-output',
  use: {
    baseURL: WEB_ORIGIN,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 },
    video: 'on',
    launchOptions: { slowMo: 250 },
    trace: 'off',
    screenshot: 'off',
  },
});
