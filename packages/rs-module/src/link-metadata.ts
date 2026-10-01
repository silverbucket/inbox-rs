/**
 * Link metadata fetching through Sockethub's stateless `metadata` platform.
 * Shared so the web app and browser extension normalize responses identically.
 */

export const DEFAULT_SOCKETHUB_ENDPOINT =
  'https://sockethub.silverbucket.net/sockethub-http';

const METADATA_CONTEXT = [
  'https://www.w3.org/ns/activitystreams',
  'https://sockethub.org/ns/context/v1.jsonld',
  'https://sockethub.org/ns/context/platform/metadata/v1.jsonld',
];

const FETCH_TIMEOUT_MS = 30_000;

export interface LinkMetadata {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

export interface SockethubInfo {
  name: 'sockethub';
  apiVersion: number;
  platforms: Array<{ id: string; apiVersion: number }>;
}

export async function fetchSockethubInfo(
  endpoint: string = DEFAULT_SOCKETHUB_ENDPOINT,
): Promise<SockethubInfo | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) return null;

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') return null;
  const info = payload as Record<string, unknown>;
  if (
    info.name !== 'sockethub' ||
    !Number.isInteger(info.apiVersion) ||
    (info.apiVersion as number) < 0 ||
    !Array.isArray(info.platforms)
  ) {
    return null;
  }
  const platforms = info.platforms.flatMap((platform) => {
    if (!platform || typeof platform !== 'object') return [];
    const entry = platform as Record<string, unknown>;
    return typeof entry.id === 'string' &&
      entry.id.trim() &&
      Number.isInteger(entry.apiVersion) &&
      (entry.apiVersion as number) >= 0
      ? [{ id: entry.id.trim(), apiVersion: entry.apiVersion as number }]
      : [];
  });
  return {
    name: 'sockethub',
    apiVersion: info.apiVersion as number,
    platforms,
  };
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

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

export function normalizeMetadata(
  object: unknown,
  baseUrl?: string,
): LinkMetadata | null {
  if (!object || typeof object !== 'object') return null;
  const metadata = object as Record<string, unknown>;
  const rawImage = Array.isArray(metadata.image)
    ? metadata.image[0]
    : metadata.image;
  const image =
    asNonEmptyString(rawImage) ??
    asNonEmptyString((rawImage as Record<string, unknown> | undefined)?.url);
  const normalized: LinkMetadata = {
    title: asNonEmptyString(metadata.title),
    description:
      asNonEmptyString(metadata.description) ??
      asNonEmptyString(metadata.summary),
    image: asHttpUrl(image, baseUrl),
    siteName:
      asNonEmptyString(metadata.siteName) ??
      asNonEmptyString(metadata.site_name) ??
      asNonEmptyString(metadata.name),
    favicon: asHttpUrl(
      asNonEmptyString(metadata.favicon) ?? asNonEmptyString(metadata.icon),
      baseUrl,
    ),
  };
  return normalized.title ||
    normalized.description ||
    normalized.image ||
    normalized.siteName ||
    normalized.favicon
    ? normalized
    : null;
}

export async function fetchLinkMetadata(
  url: string,
  endpoint: string = DEFAULT_SOCKETHUB_ENDPOINT,
): Promise<LinkMetadata | null> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': crypto.randomUUID(),
    },
    body: JSON.stringify({
      '@context': METADATA_CONTEXT,
      type: 'fetch',
      actor: { id: url, type: 'website' },
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Metadata server responded with ${response.status}`);
  }

  const text = await response.text();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      continue;
    }
    const result = payload as Record<string, unknown>;
    if (typeof result.error === 'string' && result.error) {
      throw new Error(result.error);
    }
    return normalizeMetadata(result.object, url);
  }
  return null;
}
