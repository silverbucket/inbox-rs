import {
  DirectRS,
  type RSConfig,
  connectViaOAuth as sharedConnectViaOAuth,
} from '@inbox-rs/rs-module';

export type { RSConfig };
export { DirectRS };

/**
 * WebFinger discovery + OAuth via Thunderbird's identity API.
 *
 * Discovery, OAuth params, and token extraction live in the shared
 * `@inbox-rs/rs-module` runtime; this wrapper supplies Thunderbird-specific
 * glue (the global `browser.identity` API).
 *
 * The OAuth `client_id` is derived from the redirect URL's origin — this is
 * the convention every remoteStorage provider follows (RS spec §10), and
 * Armadietto in particular rejects anything else with
 * `OAuth error: invalid_client`. A previous version of this file passed a
 * static identifier (`'inbox-rs-thunderbird'`) which broke against any
 * spec-compliant server. The Chrome/Firefox extension (lib/rs.ts) uses the
 * same redirect-origin trick — keep these two wrappers in lockstep.
 */
export async function connectViaOAuth(userAddress: string): Promise<RSConfig> {
  const redirectUrl = browser.identity.getRedirectURL();
  return sharedConnectViaOAuth(userAddress, {
    clientId: new URL(redirectUrl).origin,
    redirectUrl,
    launchAuthFlow: (url) =>
      browser.identity.launchWebAuthFlow({
        url,
        interactive: true,
      }) as Promise<string>,
  });
}
