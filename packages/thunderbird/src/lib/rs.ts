import {
  connectViaOAuth as sharedConnectViaOAuth,
  DirectRS,
  type RSConfig,
} from '@inbox-rs/rs-module';

export { DirectRS };
export type { RSConfig };

/** Static OAuth client id — Thunderbird does not provide a redirect-derived origin. */
const THUNDERBIRD_CLIENT_ID = 'inbox-rs-thunderbird';

/**
 * WebFinger discovery + OAuth via Thunderbird's identity API.
 *
 * Discovery, OAuth params, and token extraction live in the shared
 * `@inbox-rs/rs-module` runtime; this wrapper supplies Thunderbird-specific
 * glue (the global `browser.identity` API and a static client id).
 */
export async function connectViaOAuth(userAddress: string): Promise<RSConfig> {
  const redirectUrl = browser.identity.getRedirectURL();
  return sharedConnectViaOAuth(userAddress, {
    clientId: THUNDERBIRD_CLIENT_ID,
    redirectUrl,
    launchAuthFlow: (url) =>
      browser.identity.launchWebAuthFlow({ url, interactive: true }) as Promise<string>,
  });
}
