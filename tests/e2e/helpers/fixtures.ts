/**
 * Shared Playwright fixtures for the inbox-rs e2e suite.
 *
 * The suite runs against:
 *
 * - A locally-running Armadietto instance on :8000 (started by Playwright's
 *   `webServer` config in `playwright.config.ts`).
 * - The web app's *production preview* on :4173 (`vite preview` of the
 *   built `dist/`). We test the production build because PWA behaviour
 *   (manifest, asset paths, build-time defines) only matches reality
 *   after the build step.
 *
 * If you need to iterate fast against the dev server instead, override
 * `WEB_ORIGIN`:
 *
 *     WEB_ORIGIN=http://localhost:5173 npx playwright test --grep navigation
 *
 * …but be aware the dev server's HMR shim makes some load-state
 * assertions flakier and emits non-error console noise.
 */

import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import {
  ensureUser,
  makeRsUser,
  oauthToken,
  waitForArmadietto,
  type RsUser,
} from './armadietto';
import { seedRsSession } from './pwa';

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:4173';

type WorkerFixtures = {
  /** Origin of the web app under test (preview server by default). */
  webOrigin: string;
  /**
   * A unique signed-up Armadietto user, stable across the worker.
   *
   * We use a random suffix so reruns against a persistent Docker volume
   * don't accumulate state from earlier failed runs colliding on the same
   * storage paths.
   */
  rsUser: RsUser;
  /**
   * OAuth token for `rsUser`, valid against the test web origin.
   *
   * Issued once per worker because Armadietto tokens don't expire on the
   * short timescales we run tests at and re-issuing for every test would
   * triple the suite's wall-clock time.
   */
  rsToken: string;
};

type TestFixtures = {
  /**
   * A signed-up Armadietto user that exists only for this test. Use when
   * a test needs a guaranteed-empty account or wants to PUT data to the
   * server before the web app touches it (see `putInboxItem`).
   */
  freshRsUser: RsUser;
  /** OAuth token for the per-test `freshRsUser`. */
  freshRsToken: string;
  /**
   * A `BrowserContext` with the worker's RS session pre-seeded into
   * localStorage, so the web app boots straight into the connected UI.
   */
  connectedContext: BrowserContext;
  /** A `Page` opened from `connectedContext`. */
  connectedPage: Page;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  webOrigin: [WEB_ORIGIN, { scope: 'worker' }],

  rsUser: [
    async ({}, use) => {
      await waitForArmadietto();
      const suffix = randomBytes(4).toString('hex');
      const user = makeRsUser(`e2e_${suffix}`, 'e2e_pass_1234');
      await ensureUser(user);
      await use(user);
    },
    { scope: 'worker' },
  ],

  rsToken: [
    async ({ rsUser, webOrigin }, use) => {
      const token = await oauthToken(rsUser, { clientOrigin: webOrigin });
      await use(token);
    },
    { scope: 'worker' },
  ],

  freshRsUser: async ({}, use) => {
    await waitForArmadietto();
    const suffix = randomBytes(4).toString('hex');
    const user = makeRsUser(`e2e_fresh_${suffix}`, 'e2e_pass_1234');
    await ensureUser(user);
    await use(user);
  },

  freshRsToken: async ({ freshRsUser, webOrigin }, use) => {
    const token = await oauthToken(freshRsUser, { clientOrigin: webOrigin });
    await use(token);
  },

  connectedContext: async ({ context, rsUser, rsToken, webOrigin }, use) => {
    await seedRsSession(context, rsUser, rsToken, { clientOrigin: webOrigin });
    await use(context);
  },

  connectedPage: async ({ connectedContext }, use) => {
    const page = await connectedContext.newPage();
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
