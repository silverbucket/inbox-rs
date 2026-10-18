import {
  DirectRS,
  type RSConfig,
  connectViaOAuth as sharedConnectViaOAuth,
} from '@inbox-rs/rs-module/runtime';

export type { RSConfig };
export { DirectRS };

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
    launchAuthFlow: (url) =>
      identity.launchWebAuthFlow({ url, interactive: true }) as Promise<string>,
  });
}
