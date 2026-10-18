import {
  DEFAULT_SOCKETHUB_ENDPOINT,
  fetchLinkMetadata,
  type LinkMetadata,
  type UserSettings,
} from '@inbox-rs/rs-module';

const SAVE_METADATA_TIMEOUT_MS = 3_000;

type SettingsReader = {
  getUserSettings(): Promise<UserSettings>;
};

type MetadataFetcher = (
  url: string,
  endpoint: string,
  signal?: AbortSignal,
) => Promise<LinkMetadata | null>;

/**
 * Fetch metadata only after the user explicitly saves an HTTP(S) page.
 *
 * The extension deliberately uses the built-in relay rather than the synced
 * custom endpoint. Extension fetches have broad host privileges, so following
 * a remotely synced endpoint would let another linked client redirect this
 * browser into making requests to its local network.
 */
export async function fetchPageMetadataForSave(
  settingsReader: SettingsReader,
  pageUrl: string,
  fetcher: MetadataFetcher = fetchLinkMetadata,
  timeoutMs = SAVE_METADATA_TIMEOUT_MS,
): Promise<LinkMetadata | null> {
  let metadataUrl: URL;
  try {
    metadataUrl = new URL(pageUrl);
  } catch {
    return null;
  }
  if (metadataUrl.protocol !== 'http:' && metadataUrl.protocol !== 'https:') {
    return null;
  }

  // Fragments and embedded HTTP credentials are not needed for metadata and
  // may contain secrets that should not be sent to a relay.
  metadataUrl.hash = '';
  metadataUrl.username = '';
  metadataUrl.password = '';

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lookup = (async () => {
    let settings: UserSettings;
    try {
      settings = await settingsReader.getUserSettings();
    } catch {
      return null;
    }
    if (controller.signal.aborted || settings.linkPreviews === false) {
      return null;
    }
    try {
      return await fetcher(
        metadataUrl.href,
        DEFAULT_SOCKETHUB_ENDPOINT,
        controller.signal,
      );
    } catch {
      return null;
    }
  })();
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });

  try {
    return await Promise.race([lookup, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
