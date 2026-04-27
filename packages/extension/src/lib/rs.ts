import RemoteStorage from 'remotestoragejs';
import InboxModule, {
  connectViaOAuth as sharedConnectViaOAuth,
  DirectRS,
  type RSConfig,
} from '@inbox-rs/rs-module';

export { DirectRS };
export type { RSConfig };

export function createRS(): RemoteStorage {
  const rs = new RemoteStorage({
    modules: [InboxModule],
    changeEvents: { local: false, window: false, remote: false, conflict: false }
  });

  rs.access.claim('inbox', 'rw');
  // No caching — extension makes direct remote requests
  return rs;
}

/** Resolve to whichever identity API is available in this browser. */
function getIdentityApi() {
  if (typeof chrome !== 'undefined' && chrome.identity) return chrome.identity;
  return browser.identity;
}

/**
 * WebFinger discovery + OAuth via the WebExtension identity API.
 *
 * Discovery, OAuth params, and token extraction all live in the shared
 * `@inbox-rs/rs-module` runtime — this wrapper supplies the platform glue
 * (the identity API, the redirect URL the browser whitelists for this
 * extension, and a client id derived from that redirect's origin).
 */
export async function connectViaOAuth(userAddress: string): Promise<RSConfig> {
  const identity = getIdentityApi();
  const redirectUrl = identity.getRedirectURL();
  return sharedConnectViaOAuth(userAddress, {
    clientId: new URL(redirectUrl).origin,
    redirectUrl,
    launchAuthFlow: (url) => identity.launchWebAuthFlow({ url, interactive: true }) as Promise<string>,
  });
}

/**
 * Configure an RS instance with a previously obtained token.
 */
export function configureRS(rs: RemoteStorage, config: RSConfig): void {
  rs.remote.configure({
    userAddress: config.userAddress,
    href: config.href!,
    storageApi: config.storageApi!,
    token: config.token!,
    properties: undefined
  });
}
