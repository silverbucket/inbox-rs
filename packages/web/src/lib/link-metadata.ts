/**
 * Web-app wrapper around the shared Sockethub metadata client. The web build
 * may override the default relay through Vite; browser plugins use the same
 * shared protocol implementation with the repository default.
 */

import {
  type DownloadedImage,
  downloadLinkImage as downloadSharedLinkImage,
  fetchLinkMetadata as fetchSharedLinkMetadata,
  fetchSockethubInfo as fetchSharedSockethubInfo,
  type LinkMetadata,
  normalizeMetadata,
  DEFAULT_SOCKETHUB_ENDPOINT as SHARED_DEFAULT_SOCKETHUB_ENDPOINT,
  type SockethubInfo,
  supportsImageDownload,
} from '@inbox-rs/rs-module';

export type { DownloadedImage, LinkMetadata, SockethubInfo };
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

export function downloadLinkImage(
  pageUrl: string,
  imageUrl: string,
  endpoint: string = DEFAULT_SOCKETHUB_ENDPOINT,
): Promise<DownloadedImage> {
  return downloadSharedLinkImage(pageUrl, imageUrl, endpoint);
}

const imageDownloadSupport = new Map<string, Promise<boolean>>();

/**
 * Whether this Sockethub server offers image downloads (its `media`
 * platform), asked once per endpoint. An unreachable server is asked again
 * next time, since that says nothing about what it offers.
 */
export function canDownloadImages(
  endpoint: string = DEFAULT_SOCKETHUB_ENDPOINT,
): Promise<boolean> {
  let support = imageDownloadSupport.get(endpoint);
  if (!support) {
    support = fetchSockethubInfo(endpoint).then(supportsImageDownload);
    imageDownloadSupport.set(endpoint, support);
    support.catch(() => imageDownloadSupport.delete(endpoint));
  }
  return support.catch(() => false);
}
