/**
 * Armadietto remoteStorage server helpers.
 *
 * The web app talks to whatever RS server you point it at, but our local CI
 * test rig spins up Armadietto on http://localhost:8000 (matching the dev
 * docker-compose). These helpers cover the things tests need from it:
 *
 * 1. `ensureUser(...)`   — idempotent signup so the first test run on a
 *    fresh container can authenticate.
 * 2. `oauthToken(...)`   — drives the OAuth `/oauth/<user>` POST and returns
 *    the access token from the redirect Location, so a test can pre-seed
 *    the web app's auth state without driving the click-through UI.
 * 3. `putInboxItem(...)` — direct PUT to `/storage/<user>/inbox/items/<id>`
 *    so a test can pre-populate the user's storage with documents *before*
 *    the web app ever connects, simulating an "existing account with data"
 *    first-load scenario.
 *
 * We deliberately keep these as plain `fetch` calls rather than going
 * through Playwright. The OAuth click-through is itself a UI that's part
 * of *Armadietto*, not part of inbox-rs — exercising it with the browser
 * would mostly test Armadietto's HTML, not our PWA.
 */

import { setTimeout as delay } from 'node:timers/promises';
import type { InboxItem } from '@inbox-rs/rs-module';

// These constants match docker-compose.yml + armadietto.conf.json. Keeping
// them in one place so a future server-port move is a single-line change.
export const ARMADIETTO_ORIGIN = 'http://localhost:8000';
const DEFAULT_TIMEOUT_MS = 10_000;

export type RsUser = {
  readonly username: string;
  readonly password: string;
  readonly host: string;
  /** User-facing remoteStorage address (`user@host`). */
  readonly address: string;
};

export function makeRsUser(
  username: string,
  password: string,
  host = 'localhost:8000',
): RsUser {
  return { username, password, host, address: `${username}@${host}` };
}

/**
 * Block until Armadietto is reachable, throw on timeout.
 *
 * Used by per-worker fixtures; the Playwright `webServer` config already
 * waited on the port to bind, but Armadietto serves a 404 for the briefest
 * moment between bind and route-table init. A quick GET / settles that.
 */
export async function waitForArmadietto(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${ARMADIETTO_ORIGIN}/`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (r.status === 200) return;
    } catch (e) {
      lastErr = e;
    }
    await delay(250);
  }
  throw new Error(
    `Armadietto never became ready at ${ARMADIETTO_ORIGIN}: ${String(lastErr)}`,
  );
}

/**
 * Sign up `user` if they don't exist yet. Idempotent.
 *
 * Armadietto's /signup returns 200/201 on success and 409 if the username
 * is taken — we treat all three as success. Any other status is a hard
 * failure so misconfigured tests fail loudly instead of silently sharing a
 * stale account.
 */
export async function ensureUser(
  user: RsUser,
  email?: string,
): Promise<RsUser> {
  const body = new URLSearchParams({
    username: user.username,
    email: email ?? `${user.username}@e2e.local`,
    password: user.password,
    signup: 'Go',
  });
  const r = await fetch(`${ARMADIETTO_ORIGIN}/signup`, {
    method: 'POST',
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (r.status === 200 || r.status === 201 || r.status === 409) return user;
  const text = await r.text().catch(() => '');
  throw new Error(
    `Armadietto signup for ${user.username} failed: HTTP ${r.status} — ${text.slice(0, 200)}`,
  );
}

/**
 * Run the OAuth implicit flow and return the access token.
 *
 * `clientOrigin` is what remoteStorage.js sends as `client_id` — typically
 * the origin the PWA is served from (`http://localhost:4173` for our
 * preview server). Scopes default to what `packages/web/src/lib/rs.ts`
 * claims.
 *
 * Returns the bare bearer token; callers inject it into localStorage so
 * the web app picks up an already-authorized session on next load.
 */
export async function oauthToken(
  user: RsUser,
  options: { clientOrigin: string; scopes?: string },
): Promise<string> {
  const { clientOrigin, scopes = 'inbox:rw shares:rw' } = options;
  const body = new URLSearchParams({
    client_id: clientOrigin,
    redirect_uri: `${clientOrigin}/`,
    response_type: 'token',
    scope: scopes,
    state: '',
    username: user.username,
    password: user.password,
    allow: 'Allow',
  });
  const r = await fetch(`${ARMADIETTO_ORIGIN}/oauth`, {
    method: 'POST',
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (r.status !== 302) {
    const text = await r.text().catch(() => '');
    throw new Error(
      `OAuth Allow for ${user.username} returned HTTP ${r.status}, expected 302. Body: ${text.slice(0, 200)}`,
    );
  }
  const location = r.headers.get('Location') ?? '';
  // Armadietto returns `…/#access_token=…&token_type=bearer&state=…`
  const fragment = location.split('#')[1] ?? '';
  for (const kv of fragment.split('&')) {
    const [k, v = ''] = kv.split('=');
    if (k === 'access_token') return decodeURIComponent(v);
  }
  throw new Error(`OAuth redirect missing access_token: ${location}`);
}

/**
 * Write a single inbox item directly to RS, bypassing the web app.
 *
 * Targets `PUT /storage/<user>/inbox/items/<id>`, which is the same path
 * `rs-module`'s `store(...)` uses via `privateClient.storeObject(...,
 * 'items/<id>', ...)`. The web app picks the item up on its next sync —
 * that's how we simulate a "first load against an existing account".
 *
 * `_migrateVersion` is intentionally optional in the document. The
 * rs-module `getAll` call auto-stamps the latest version onto un-stamped
 * items of current types, so leaving it off keeps tests decoupled from
 * the migration version counter.
 */
export async function putInboxItem(
  user: RsUser,
  token: string,
  options: { item: InboxItem },
): Promise<void> {
  const { item } = options;
  if (!item.id) throw new Error('inbox item must have a string `id`');
  const r = await fetch(
    `${ARMADIETTO_ORIGIN}/storage/${user.username}/inbox/items/${item.id}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(item),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    },
  );
  if (r.status !== 200 && r.status !== 201) {
    const text = await r.text().catch(() => '');
    throw new Error(
      `PUT /inbox/items/${item.id} for ${user.username} failed: HTTP ${r.status} — ${text.slice(0, 200)}`,
    );
  }
}

/**
 * Write a single binary file directly to RS, bypassing the web app.
 *
 * Targets `PUT /storage/<user>/inbox/<path>`, the same location the
 * rs-module's `storeFile(...)` writes to (image bytes live under
 * `files/<id>.<ext>`, thumbnails under `files/<id>.thumb.jpg`). Pairing
 * this with `putInboxItem` lets a test stage an image that exists *only*
 * on the server — never in any browser's local cache — which is exactly
 * the state a brand-new device (e.g. a phone that captured nothing) sees.
 *
 * The device that captured an image always has its bytes in local
 * IndexedDB, so it renders regardless of whether the upload reached the
 * server. Only a fresh device actually exercises the authenticated
 * `fetchFileWithAuth` GET path — so seeding via the server (not the UI)
 * is the only way to test that path honestly.
 */
export async function putInboxFile(
  user: RsUser,
  token: string,
  options: {
    path: string;
    body: ArrayBuffer | Uint8Array;
    contentType: string;
  },
): Promise<void> {
  const { path, body, contentType } = options;
  if (!path.startsWith('files/')) {
    throw new Error(`inbox file path must start with "files/": ${path}`);
  }
  const r = await fetch(
    `${ARMADIETTO_ORIGIN}/storage/${user.username}/inbox/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    },
  );
  if (r.status !== 200 && r.status !== 201) {
    const text = await r.text().catch(() => '');
    throw new Error(
      `PUT /inbox/${path} for ${user.username} failed: HTTP ${r.status} — ${text.slice(0, 200)}`,
    );
  }
}

/**
 * Read every inbox item straight from the server, bypassing the web app and
 * its local cache. This is the only honest way to assert that an autosave
 * actually *left the device* — the app's own UI can render a change that
 * exists nowhere but a device-local recovery draft.
 */
export async function getInboxItems(
  user: RsUser,
  token: string,
): Promise<InboxItem[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const listing = await fetch(
    `${ARMADIETTO_ORIGIN}/storage/${user.username}/inbox/items/`,
    { headers, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) },
  );
  if (listing.status === 404) return [];
  if (!listing.ok) {
    throw new Error(`GET /inbox/items/ failed: HTTP ${listing.status}`);
  }
  const folder = (await listing.json()) as { items?: Record<string, unknown> };
  const ids = Object.keys(folder.items ?? {}).filter((k) => !k.endsWith('/'));
  return Promise.all(
    ids.map(async (id) => {
      const r = await fetch(
        `${ARMADIETTO_ORIGIN}/storage/${user.username}/inbox/items/${id}`,
        { headers, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) },
      );
      if (!r.ok) throw new Error(`GET /inbox/items/${id}: HTTP ${r.status}`);
      return (await r.json()) as InboxItem;
    }),
  );
}
