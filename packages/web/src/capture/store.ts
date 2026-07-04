import type {
  AudioItem,
  ImageItem,
  InboxItem,
  NoteItem,
} from '@inbox-rs/rs-module';
import {
  DirectRS,
  discoverStorage,
  extractTokenFromRedirect,
  type RSConfig,
} from '@inbox-rs/rs-module/runtime';
import { generateThumbnail, THUMB_MIME_TYPE } from '../lib/thumbnail';

/** The three ways to capture. Maps to inbox item types note / audio / image. */
export type CaptureMode = 'note' | 'voice' | 'image';

/** Delivery state of a captured item, surfaced in the history view. */
export type DeliveryStatus = 'queued' | 'sending' | 'synced' | 'failed';

/**
 * A single capture and its delivery state. Persisted as JSON in localStorage;
 * any binary payload (photo/voice) is held separately in IndexedDB under the
 * same `id` and referenced via `hasBlob`.
 */
export type CaptureRecord = {
  id: string;
  mode: CaptureMode;
  preview: string;
  createdAt: string;
  status: DeliveryStatus;
  lastError?: string;
  item: InboxItem;
  hasBlob: boolean;
  /** A generated thumbnail is queued in IndexedDB under `<id>:thumb`. */
  hasThumb?: boolean;
};

const CONFIG_KEY = 'inbox-rs-capture:config';
const PENDING_AUTH_KEY = 'inbox-rs-capture:pending-auth';
const HISTORY_KEY = 'inbox-rs-capture:history';

// ---------------------------------------------------------------------------
// remoteStorage connection (unchanged from the original capture flow)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Capture history + delivery queue
// ---------------------------------------------------------------------------

export function getHistory(): CaptureRecord[] {
  const records = readJson<CaptureRecord[]>(HISTORY_KEY) ?? [];
  // A 'sending' record means we were interrupted mid-flush (e.g. a reload);
  // treat it as still queued so it gets retried.
  return records.map((r) =>
    r.status === 'sending' ? { ...r, status: 'queued' } : r,
  );
}

function saveHistory(records: CaptureRecord[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(records));
}

function isPending(record: CaptureRecord): boolean {
  return record.status !== 'synced';
}

/** Count of captures not yet delivered (queued, sending, or failed). */
export function pendingCount(records: CaptureRecord[] = getHistory()): number {
  return records.filter(isPending).length;
}

function newRecord(
  id: string,
  mode: CaptureMode,
  preview: string,
  item: InboxItem,
  hasBlob: boolean,
): CaptureRecord {
  return {
    id,
    mode,
    preview,
    createdAt: new Date().toISOString(),
    status: 'queued',
    item,
    hasBlob,
  };
}

function prepend(record: CaptureRecord): void {
  saveHistory([record, ...getHistory()]);
}

/** Queue a text note for delivery. */
export function captureNote(text: string): CaptureRecord {
  const trimmed = text.trim();
  const id = crypto.randomUUID();
  const item: NoteItem = {
    id,
    type: 'note',
    title: trimmed.slice(0, 50) || 'Note',
    body: trimmed,
    createdAt: new Date().toISOString(),
  };
  const record = newRecord(
    id,
    'note',
    trimmed.slice(0, 120) || 'Note',
    item,
    false,
  );
  prepend(record);
  return record;
}

/** Queue a photo for delivery; the binary is held in IndexedDB until synced. */
export async function captureImage(file: File): Promise<CaptureRecord> {
  const id = crypto.randomUUID();
  const ext = extFromName(file.name) || extFromMime(file.type) || '.jpg';
  // Best-effort thumbnail (null when the source is already small or can't be
  // decoded); queued alongside the original and uploaded on flush.
  const thumb = await generateThumbnail(file);
  const item: ImageItem = {
    id,
    type: 'image',
    title: file.name || 'Photo',
    filePath: `files/${id}${ext}`,
    mimeType: file.type || 'image/jpeg',
    thumbPath: thumb ? `files/${id}.thumb.jpg` : undefined,
    thumbMimeType: thumb ? THUMB_MIME_TYPE : undefined,
    createdAt: new Date().toISOString(),
  };
  await putBlob(id, file);
  if (thumb) {
    await putBlob(
      thumbKey(id),
      new Blob([thumb.data], { type: thumb.mimeType }),
    );
  }
  const record = newRecord(id, 'image', file.name || 'Photo', item, true);
  const withThumb: CaptureRecord = { ...record, hasThumb: !!thumb };
  prepend(withThumb);
  return withThumb;
}

/** IndexedDB key for a capture's queued thumbnail bytes. */
function thumbKey(id: string): string {
  return `${id}:thumb`;
}

/** Queue a voice memo for delivery; the binary is held in IndexedDB. */
export async function captureVoice(
  blob: Blob,
  durationSec?: number,
): Promise<CaptureRecord> {
  const id = crypto.randomUUID();
  const ext = blob.type.includes('mp4')
    ? '.mp4'
    : blob.type.includes('ogg')
      ? '.ogg'
      : '.webm';
  const item: AudioItem = {
    id,
    type: 'audio',
    title: 'Voice memo',
    filePath: `files/${id}${ext}`,
    mimeType: blob.type || 'audio/webm',
    duration: durationSec,
    createdAt: new Date().toISOString(),
  };
  await putBlob(id, blob);
  const preview = durationSec
    ? `Voice memo · ${formatDuration(durationSec)}`
    : 'Voice memo';
  const record = newRecord(id, 'voice', preview, item, true);
  prepend(record);
  return record;
}

/**
 * Deliver every pending capture to remoteStorage, oldest first (FIFO), updating
 * each record's status as it goes. Safe to call repeatedly — it also retries
 * anything previously marked failed.
 */
export async function flushQueue(
  config: RSConfig | null = getConfig(),
): Promise<CaptureRecord[]> {
  let records = getHistory();
  if (!config?.href || !config.token) return records;

  const rs = new DirectRS(config);
  const pending = records.filter(isPending).reverse(); // oldest first

  for (const entry of pending) {
    records = patch(records, entry.id, {
      status: 'sending',
      lastError: undefined,
    });
    saveHistory(records);
    try {
      const fileData = entry.hasBlob ? await getBlobBytes(entry.id) : undefined;
      const thumbData = entry.hasThumb
        ? await getBlobBytes(thumbKey(entry.id))
        : undefined;
      await rs.store(entry.item, fileData, thumbData);
      records = patch(records, entry.id, {
        status: 'synced',
        lastError: undefined,
      });
      if (entry.hasBlob) await deleteBlob(entry.id);
      if (entry.hasThumb) await deleteBlob(thumbKey(entry.id));
    } catch (error) {
      records = patch(records, entry.id, {
        status: 'failed',
        lastError: errorMessage(error),
      });
    }
    saveHistory(records);
  }
  return records;
}

/** Remove a capture from history and discard any pending binary. */
export async function removeRecord(id: string): Promise<CaptureRecord[]> {
  const records = getHistory().filter((r) => r.id !== id);
  saveHistory(records);
  await deleteBlob(id);
  await deleteBlob(thumbKey(id));
  return records;
}

function patch(
  records: CaptureRecord[],
  id: string,
  changes: Partial<CaptureRecord>,
): CaptureRecord[] {
  return records.map((r) => (r.id === id ? { ...r, ...changes } : r));
}

// ---------------------------------------------------------------------------
// Binary blob storage (IndexedDB, with an in-memory fallback for non-DOM envs)
// ---------------------------------------------------------------------------

const DB_NAME = 'inbox-rs-capture';
const BLOB_STORE = 'blobs';
const memoryBlobs = new Map<string, Blob>();

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BLOB_STORE)) {
        request.result.createObjectStore(BLOB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function putBlob(id: string, blob: Blob): Promise<void> {
  if (!idbAvailable()) {
    memoryBlobs.set(id, blob);
    return;
  }
  const db = await openDb();
  const tx = db.transaction(BLOB_STORE, 'readwrite');
  tx.objectStore(BLOB_STORE).put(blob, id);
  await txDone(tx);
  db.close();
}

async function getBlobBytes(id: string): Promise<ArrayBuffer | undefined> {
  if (!idbAvailable()) {
    return memoryBlobs.get(id)?.arrayBuffer();
  }
  const db = await openDb();
  const tx = db.transaction(BLOB_STORE, 'readonly');
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = tx.objectStore(BLOB_STORE).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return blob?.arrayBuffer();
}

async function deleteBlob(id: string): Promise<void> {
  if (!idbAvailable()) {
    memoryBlobs.delete(id);
    return;
  }
  const db = await openDb();
  const tx = db.transaction(BLOB_STORE, 'readwrite');
  tx.objectStore(BLOB_STORE).delete(id);
  await txDone(tx);
  db.close();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extFromName(name: string): string | null {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : null;
}

function extFromMime(mime: string): string | null {
  if (!mime) return null;
  if (mime === 'image/jpeg') return '.jpg';
  const slash = mime.indexOf('/');
  return slash > 0 ? `.${mime.slice(slash + 1)}` : null;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
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
