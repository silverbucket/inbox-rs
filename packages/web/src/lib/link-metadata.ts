/**
 * Link metadata fetching via a Sockethub server's stateless `metadata`
 * platform (Open Graph extraction). The browser can't scrape arbitrary
 * pages itself — CORS blocks cross-origin HTML fetches — so we relay
 * through Sockethub's HTTP actions endpoint: POST an ActivityStreams
 * `fetch` for a URL, get back an NDJSON line with the page's
 * title/description/image.
 *
 * We use the one-shot HTTP endpoint rather than the socket.io client on
 * purpose: the metadata platform is stateless (no credentials, no connect
 * step), so each lookup is a pure request/response — no websocket
 * lifecycle to manage and no client libraries to ship.
 *
 * NOTE: the server must run a Sockethub recent enough to have HTTP
 * actions, with `httpActions: { enabled: true }` in its config.
 */

/**
 * Default Sockethub HTTP actions endpoint. Overridable per build via
 * VITE_SOCKETHUB_URL and per user via the `sockethubUrl` user setting
 * (see resolveSockethubEndpoint in enrich.ts).
 */
export const DEFAULT_SOCKETHUB_ENDPOINT: string =
  import.meta.env?.VITE_SOCKETHUB_URL ||
  'https://sockethub.silverbucket.net/sockethub-http';

/**
 * Canonical @context identifying the metadata platform. Sockethub resolves
 * the target platform from the URL prefixed `.../ns/context/platform/`.
 */
const METADATA_CONTEXT = [
  'https://www.w3.org/ns/activitystreams',
  'https://sockethub.org/ns/context/v1.jsonld',
  'https://sockethub.org/ns/context/platform/metadata/v1.jsonld',
];

/** Client-side cap; the server also enforces its own request timeout. */
const FETCH_TIMEOUT_MS = 30_000;

export interface LinkMetadata {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

/**
 * Resolve a possibly-relative media URL against the fetched page and keep
 * only http(s) results — servers echo whatever the page's tags contain
 * (`/favicon.ico`, protocol-relative paths, or junk schemes), and these
 * values end up in `<img src>` attributes.
 */
function asHttpUrl(
  value: string | undefined,
  baseUrl?: string,
): string | undefined {
  if (!value) return undefined;
  try {
    const resolved = new URL(value, baseUrl);
    if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
      return resolved.href;
    }
  } catch {
    // Unparseable even against the base — drop it.
  }
  return undefined;
}

/**
 * Shape a metadata-platform response object into LinkMetadata. Verified
 * against a live server, the object looks like:
 *
 *   { type: 'page', title, name, description, favicon,
 *     image: [{ url, width, height, alt }], url, ... }
 *
 * where `name` carries the og:site_name. `siteName`/`site_name`/`icon`
 * are read as fallbacks for other server versions. Returns null when the
 * response carries nothing usable.
 */
export function normalizeMetadata(
  object: unknown,
  baseUrl?: string,
): LinkMetadata | null {
  if (!object || typeof object !== 'object') return null;
  const o = object as Record<string, unknown>;
  // `image` may arrive as a plain URL string or an object/array of
  // { url } media descriptors depending on the page's OG tags.
  const rawImage = Array.isArray(o.image) ? o.image[0] : o.image;
  const image =
    asNonEmptyString(rawImage) ??
    asNonEmptyString((rawImage as Record<string, unknown> | undefined)?.url);
  const meta: LinkMetadata = {
    title: asNonEmptyString(o.title),
    description: asNonEmptyString(o.description) ?? asNonEmptyString(o.summary),
    image: asHttpUrl(image, baseUrl),
    siteName:
      asNonEmptyString(o.siteName) ??
      asNonEmptyString(o.site_name) ??
      asNonEmptyString(o.name),
    favicon: asHttpUrl(
      asNonEmptyString(o.favicon) ?? asNonEmptyString(o.icon),
      baseUrl,
    ),
  };
  // A resolved favicon alone still counts — plenty of pages have no OG
  // tags but a conventional /favicon.ico, and the card UI renders it.
  return meta.title ||
    meta.description ||
    meta.image ||
    meta.siteName ||
    meta.favicon
    ? meta
    : null;
}

/**
 * Fetch Open Graph metadata for a URL. Resolves null when the page has no
 * usable metadata; rejects when the Sockethub server can't be reached, the
 * page fetch fails server-side, or the request times out.
 */
export async function fetchLinkMetadata(
  url: string,
  endpoint: string = DEFAULT_SOCKETHUB_ENDPOINT,
): Promise<LinkMetadata | null> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Required by the endpoint; also makes retries idempotent server-side.
      'X-Request-Id': crypto.randomUUID(),
    },
    body: JSON.stringify({
      '@context': METADATA_CONTEXT,
      type: 'fetch',
      // Schema validation requires a typed actor; URLs are `website`.
      actor: { id: url, type: 'website' },
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Metadata server responded with ${res.status}`);
  }
  // The endpoint streams NDJSON, one result line per submitted message —
  // we send a single message, so the first parseable line settles it.
  const text = await res.text();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      continue;
    }
    const p = payload as Record<string, unknown>;
    if (typeof p.error === 'string' && p.error) {
      throw new Error(p.error);
    }
    return normalizeMetadata(p.object, url);
  }
  return null;
}
