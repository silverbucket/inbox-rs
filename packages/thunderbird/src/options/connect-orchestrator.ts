/**
 * Connect-flow orchestrator for the Thunderbird options page.
 *
 * `<all_urls>` is now an optional permission (see `manifest.json`) rather
 * than a required one, so the extension has to request it itself before any
 * cross-origin fetch — the WebFinger discovery inside `connectViaOAuth`, and
 * every later `DirectRS` request, need it to reach the user's provider.
 *
 * Gecko only honours `browser.permissions.request()` when it's called
 * synchronously from a user input handler — a handler that has already
 * awaited a promise (e.g. a `fetch()`) no longer counts, and the request is
 * silently refused. `runConnect` requests `<all_urls>` as the very first
 * thing it does, with no `await` ahead of it, so the call stays inside the
 * click that invoked `connect()` in `Options.svelte`.
 */
import type { RSConfig } from '@inbox-rs/rs-module/runtime';

export type ConnectResult =
  | { ok: true; config: RSConfig }
  | { ok: false; error: string };

export interface ConnectOrchestratorDeps {
  /** Requests the `<all_urls>` host permission; resolves to whether it was granted. Must be called synchronously from a user gesture. */
  requestAllUrlsPermission: () => Promise<boolean>;
  connectViaOAuth: (userAddress: string) => Promise<RSConfig>;
}

const PERMISSION_DECLINED_MESSAGE =
  'Inbox RS needs permission to access your remoteStorage provider to connect. Please allow access and try again.';

/**
 * Run the connect flow: request `<all_urls>` (synchronously, before any
 * await — see the module docstring), then delegate to `connectViaOAuth`.
 * Never throws — any failure or declined permission becomes
 * `{ ok: false }`.
 */
export async function runConnect(
  userAddress: string,
  deps: ConnectOrchestratorDeps,
): Promise<ConnectResult> {
  try {
    const granted = await deps.requestAllUrlsPermission();
    if (!granted) {
      return { ok: false, error: PERMISSION_DECLINED_MESSAGE };
    }

    const config = await deps.connectViaOAuth(userAddress.trim());
    return { ok: true, config };
  } catch (e: unknown) {
    return { ok: false, error: errorMessage(e) };
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return 'Connection failed';
}
