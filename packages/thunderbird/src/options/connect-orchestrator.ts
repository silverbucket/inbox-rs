/**
 * Connect-flow orchestrator for the Thunderbird options page.
 *
 * `<all_urls>` is now an optional permission (see `manifest.json`) rather
 * than a required one, so the extension has to request host access itself
 * before any cross-origin fetch. Two origins are involved: the WebFinger
 * host derived from the user's address, and the storage server's origin
 * returned by discovery — these differ whenever a provider hosts storage on
 * a separate domain from the one in the user's address.
 *
 * Gecko only allows `browser.permissions.request()` to be called
 * synchronously from a user input handler — a handler that has already
 * awaited a promise (e.g. a `fetch()`) no longer counts, and the request is
 * refused. The WebFinger-host request below runs first, with no prior
 * `await`, so it stays inside the click that started `startConnect`. But the
 * storage origin isn't known until *after* the WebFinger fetch completes, so
 * it can't be requested from that same click — `startConnect` instead pauses
 * and returns `needs-storage-permission`; the Options page must get a fresh
 * click (e.g. a "Grant access" button) and call
 * `continueConnectWithStoragePermission` from that click's handler.
 *
 * Known limitation: if the WebFinger or storage origin redirects
 * cross-origin, the permission requested here won't cover the redirect
 * target and the fetch will fail. Supporting that would mean fetching with
 * `redirect: 'manual'` and re-requesting permission for each hop — providers
 * that redirect WebFinger or storage to a different origin aren't supported.
 */
import {
  discoverStorage,
  parseUserAddress,
  type RSConfig,
  type RSDiscovery,
  schemeForHost,
} from '@inbox-rs/rs-module/runtime';

export type ConnectOutcome =
  | { status: 'connected'; config: RSConfig }
  | { status: 'error'; error: string }
  | { status: 'needs-storage-permission'; origin: string };

export interface ConnectOrchestratorDeps {
  /** Requests host permission for an origin (e.g. `https://example.com`); resolves to whether it was granted. Must be called from a user gesture. */
  requestOriginPermission: (origin: string) => Promise<boolean>;
  connectViaOAuth: (userAddress: string) => Promise<RSConfig>;
}

const PERMISSION_DECLINED_MESSAGE =
  'Inbox RS needs permission to access your remoteStorage provider to connect. Please allow access and try again.';

/**
 * Start the connect flow: request permission for the WebFinger host (from
 * the same click that invoked this), then run discovery. If the discovered
 * storage origin differs from the WebFinger host, pause and report it
 * instead of requesting it here — see the module docstring. Otherwise,
 * complete OAuth immediately. Never throws — any failure or declined
 * permission becomes `{ status: 'error' }`.
 */
export async function startConnect(
  userAddress: string,
  deps: ConnectOrchestratorDeps,
): Promise<ConnectOutcome> {
  const trimmedAddress = userAddress.trim();

  try {
    const { host } = parseUserAddress(trimmedAddress);
    const webfingerOrigin = `${schemeForHost(host)}://${host}`;

    const grantedWebfinger =
      await deps.requestOriginPermission(webfingerOrigin);
    if (!grantedWebfinger) {
      return { status: 'error', error: PERMISSION_DECLINED_MESSAGE };
    }

    const discovery = await discoverStorage(trimmedAddress);
    const storageOrigin = originOf(discovery);
    if (storageOrigin !== webfingerOrigin) {
      return { status: 'needs-storage-permission', origin: storageOrigin };
    }

    const config = await deps.connectViaOAuth(trimmedAddress);
    return { status: 'connected', config };
  } catch (e: unknown) {
    return { status: 'error', error: errorMessage(e) };
  }
}

/**
 * Resume a paused connect after the user grants the storage origin
 * permission from a fresh click. Re-runs discovery (cheap, idempotent) so
 * the OAuth endpoint reflects the current server state, then completes
 * OAuth. Never throws.
 */
export async function continueConnectWithStoragePermission(
  userAddress: string,
  origin: string,
  deps: ConnectOrchestratorDeps,
): Promise<ConnectOutcome> {
  const trimmedAddress = userAddress.trim();

  try {
    const granted = await deps.requestOriginPermission(origin);
    if (!granted) {
      return { status: 'error', error: PERMISSION_DECLINED_MESSAGE };
    }

    const config = await deps.connectViaOAuth(trimmedAddress);
    return { status: 'connected', config };
  } catch (e: unknown) {
    return { status: 'error', error: errorMessage(e) };
  }
}

function originOf(discovery: RSDiscovery): string {
  return new URL(discovery.href).origin;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return 'Connection failed';
}
