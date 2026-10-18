/**
 * Web-app wrapper around the shared Sockethub metadata client. The web build
 * may override the default relay through Vite; browser plugins use the same
 * shared protocol implementation with the repository default.
 */

import {
  fetchLinkMetadata as fetchSharedLinkMetadata,
  fetchSockethubInfo as fetchSharedSockethubInfo,
  type LinkMetadata,
  normalizeMetadata,
  DEFAULT_SOCKETHUB_ENDPOINT as SHARED_DEFAULT_SOCKETHUB_ENDPOINT,
  type SockethubInfo,
} from '@inbox-rs/rs-module';

export type { LinkMetadata, SockethubInfo };
export { normalizeMetadata };

export const DEFAULT_SOCKETHUB_ENDPOINT: string =
  import.meta.env?.VITE_SOCKETHUB_URL || SHARED_DEFAULT_SOCKETHUB_ENDPOINT;

export function fetchSockethubInfo(
  endpoint: string = DEFAULT_SOCKETHUB_ENDPOINT,
): Promise<SockethubInfo | null> {
  return fetchSharedSockethubInfo(endpoint);
}

export function fetchLinkMetadata(
  url: string,
  endpoint: string = DEFAULT_SOCKETHUB_ENDPOINT,
): Promise<LinkMetadata | null> {
  return fetchSharedLinkMetadata(url, endpoint);
}
