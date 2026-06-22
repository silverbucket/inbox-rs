import type { InboxItem, InboxItemType } from '@inbox-rs/rs-module';
import {
  DirectRS,
  discoverStorage,
  extractTokenFromRedirect,
  type RSConfig,
} from '@inbox-rs/rs-module/runtime';

export type CaptureType = Extract<InboxItemType, 'bookmark' | 'note' | 'todo'>;

export type QueuedCapture = {
  id: string;
  item: InboxItem;
  queuedAt: string;
  lastError?: string;
};

const CONFIG_KEY = 'inbox-rs-capture:config';
const PENDING_AUTH_KEY = 'inbox-rs-capture:pending-auth';
const QUEUE_KEY = 'inbox-rs-capture:queue';

export function getConfig(): RSConfig | null {
  return readJson<RSConfig>(CONFIG_KEY);
}

export function clearConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
}

export async function startConnect(userAddress: string): Promise<void> {
  const address = userAddress.trim();
  const discovery = await discoverStorage(address);
  // The OAuth endpoint comes straight from the user's WebFinger response, so a
  // hostile provider could hand back a `javascript:`/`data:` URL that would run
  // in our origin the moment we navigate to it. Only follow real HTTP(S)
  // endpoints — and plain HTTP only for localhost, mirroring schemeForHost.
  const authUrl = parseSafeAuthUrl(discovery.authUrl);
  localStorage.setItem(
    PENDING_AUTH_KEY,
    JSON.stringify({ userAddress: address, discovery }),
  );
  const redirectUri = `${window.location.origin}/capture/`;
  authUrl.searchParams.set('client_id', redirectUri);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', 'inbox:rw');
  window.location.href = authUrl.toString();
}

function parseSafeAuthUrl(rawAuthUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawAuthUrl);
  } catch {
    throw new Error('remoteStorage returned an invalid OAuth endpoint');
  }
  const isHttps = url.protocol === 'https:';
  const isLocalhostHttp =
    url.protocol === 'http:' && url.hostname === 'localhost';
  if (!isHttps && !isLocalhostHttp) {
    throw new Error('remoteStorage returned an insecure OAuth endpoint');
  }
  return url;
}

export function finishConnectFromRedirect(): RSConfig | null {
  // Tokens (and OAuth errors) can arrive in either the fragment or the query
  // string, so check both. An `error=` redirect still needs cleanup even though
  // it yields no token, so the pending state and callback URL are always
  // scrubbed once we've decided a callback is present.
  const callback = `${window.location.hash} ${window.location.search}`;
  if (!callback.includes('access_token=') && !callback.includes('error='))
    return getConfig();

  const pending = readJson<{
    userAddress: string;
    discovery: { href: string; storageApi?: string };
  }>(PENDING_AUTH_KEY);

  try {
    if (!pending) return getConfig();
    const config: RSConfig = {
      userAddress: pending.userAddress,
      token: extractTokenFromRedirect(window.location.href),
      href: pending.discovery.href,
      storageApi: pending.discovery.storageApi,
    };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return config;
  } catch {
    // extractTokenFromRedirect throws on `error=` responses or a missing token.
    return getConfig();
  } finally {
    localStorage.removeItem(PENDING_AUTH_KEY);
    window.history.replaceState(null, '', '/capture/');
  }
}

export function getQueue(): QueuedCapture[] {
  return readJson<QueuedCapture[]>(QUEUE_KEY) ?? [];
}

export function enqueueCapture(
  type: CaptureType,
  input: string,
): QueuedCapture {
  const item = buildCaptureItem(type, input);
  const queued: QueuedCapture = {
    id: item.id,
    item,
    queuedAt: new Date().toISOString(),
  };
  localStorage.setItem(QUEUE_KEY, JSON.stringify([...getQueue(), queued]));
  return queued;
}

export async function flushQueue(config: RSConfig | null = getConfig()) {
  if (!config?.href || !config.token) return getQueue();
  const rs = new DirectRS(config);
  const remaining: QueuedCapture[] = [];

  for (const entry of getQueue()) {
    try {
      await rs.store(entry.item);
    } catch (error) {
      remaining.push({ ...entry, lastError: errorMessage(error) });
    }
  }

  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return remaining;
}

function buildCaptureItem(type: CaptureType, input: string): InboxItem {
  const trimmed = input.trim();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  if (type === 'todo') {
    return {
      id,
      type,
      title: trimmed,
      createdAt,
      completed: false,
      isTodo: true,
    };
  }

  if (type === 'bookmark') {
    return {
      id,
      type,
      title: trimmed,
      url: normalizeUrl(trimmed),
      createdAt,
    };
  }

  return {
    id,
    type,
    title: trimmed.slice(0, 50),
    body: trimmed,
    createdAt,
  };
}

function normalizeUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  return `https://${input}`;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Sync failed';
}
