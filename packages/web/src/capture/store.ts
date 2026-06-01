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
  const discovery = await discoverStorage(userAddress.trim());
  localStorage.setItem(
    PENDING_AUTH_KEY,
    JSON.stringify({ userAddress: userAddress.trim(), discovery }),
  );
  const redirectUri = `${window.location.origin}/capture/`;
  const params = new URLSearchParams({
    client_id: redirectUri,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: 'inbox:rw',
  });
  window.location.href = `${discovery.authUrl}?${params.toString()}`;
}

export function finishConnectFromRedirect(): RSConfig | null {
  if (!window.location.hash.includes('access_token=')) return getConfig();
  const pending = readJson<{
    userAddress: string;
    discovery: { href: string; storageApi?: string };
  }>(PENDING_AUTH_KEY);
  if (!pending) return getConfig();

  const config: RSConfig = {
    userAddress: pending.userAddress,
    token: extractTokenFromRedirect(window.location.href),
    href: pending.discovery.href,
    storageApi: pending.discovery.storageApi,
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  localStorage.removeItem(PENDING_AUTH_KEY);
  window.history.replaceState(null, '', '/capture/');
  return config;
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
