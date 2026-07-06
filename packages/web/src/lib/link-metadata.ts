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

export const SOCKETHUB_HTTP_ENDPOINT =
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
 * Shape a metadata-platform response object into LinkMetadata. The platform
 * documents `title`/`description`/`image`; site name and favicon are read
 * defensively under the names open-graph-scraper based servers use, since
 * Sockethub versions differ in what they pass through. Returns null when
 * the response carries nothing usable.
 */
export function normalizeMetadata(object: unknown): LinkMetadata | null {
  if (!object || typeof object !== 'object') return null;
  const o = object as Record<string, unknown>;
  // `image` may arrive as a plain URL string or an object/array of
  // { url } media descriptors depending on the page's OG tags.
  const rawImage = Array.isArray(o.image) ? o.image[0] : o.image;
  const image =
    asNonEmptyString(rawImage) ??
    asNonEmptyString((rawImage as Record<string, unknown> | undefined)?.url);
  const meta: LinkMetadata = {
    title: asNonEmptyString(o.title) ?? asNonEmptyString(o.name),
    description: asNonEmptyString(o.description) ?? asNonEmptyString(o.summary),
    image,
    siteName: asNonEmptyString(o.siteName) ?? asNonEmptyString(o.site_name),
    favicon: asNonEmptyString(o.favicon) ?? asNonEmptyString(o.icon),
  };
  return meta.title || meta.description || meta.image || meta.siteName
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
): Promise<LinkMetadata | null> {
  const res = await fetch(SOCKETHUB_HTTP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Required by the endpoint; also makes retries idempotent server-side.
      'X-Request-Id': crypto.randomUUID(),
    },
    body: JSON.stringify({
      '@context': METADATA_CONTEXT,
      type: 'fetch',
      actor: { id: url },
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
    return normalizeMetadata(p.object);
  }
  return null;
}
