/**
 * Connect-flow orchestrator for the Thunderbird options page.
 *
 * `<all_urls>` is now an optional permission (see `manifest.json`) rather
 * than a required one, so the extension has to request host access itself
 * before any cross-origin fetch. Two origins are involved: the WebFinger
 * host derived from the user's address, and the storage server's origin
 * returned by discovery — these differ whenever a provider hosts storage on
 * a separate domain from the one in the user's address. This module asks
 * for both, in order, and turns a declined or failed request into a tagged
 * result so `Options.svelte` can show a message instead of hanging.
 */
import {
  parseUserAddress,
  type RSConfig,
  schemeForHost,
} from '@inbox-rs/rs-module/runtime';

export type ConnectResult =
  | { ok: true; config: RSConfig }
  | { ok: false; error: string };

export interface ConnectOrchestratorParams {
  userAddress: string;
  /** Requests host permission for an origin (e.g. `https://example.com`); resolves to whether it was granted. */
  requestOriginPermission: (origin: string) => Promise<boolean>;
  connectViaOAuth: (
    userAddress: string,
    onStorageOriginDiscovered: (origin: string) => Promise<void>,
  ) => Promise<RSConfig>;
}

const PERMISSION_DECLINED_MESSAGE =
  "Inbox RS needs permission to access your remoteStorage provider's address to connect. Please allow access and try again.";

/**
 * Run the connect flow: request permission for the WebFinger host, then
 * delegate to `connectViaOAuth`, requesting permission for the discovered
 * storage origin too (if it differs) before OAuth launches. Never throws —
 * any failure or declined permission becomes `{ ok: false }`.
 */
export async function runConnect(
  params: ConnectOrchestratorParams,
): Promise<ConnectResult> {
  const userAddress = params.userAddress.trim();

  try {
    const { host } = parseUserAddress(userAddress);
    const webfingerOrigin = `${schemeForHost(host)}://${host}`;

    const grantedWebfinger =
      await params.requestOriginPermission(webfingerOrigin);
    if (!grantedWebfinger) {
      return { ok: false, error: PERMISSION_DECLINED_MESSAGE };
    }

    const config = await params.connectViaOAuth(
      userAddress,
      async (storageOrigin) => {
        if (storageOrigin === webfingerOrigin) return;
        const grantedStorage =
          await params.requestOriginPermission(storageOrigin);
        if (!grantedStorage) {
          throw new Error(PERMISSION_DECLINED_MESSAGE);
        }
      },
    );

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
