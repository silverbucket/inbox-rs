import type {
  AppConfig,
  Collection,
  CollectionGroup,
  InboxItem,
  UserSettings,
} from '@inbox-rs/rs-module';
import { migrator, wrapCodeBlock } from '@inbox-rs/rs-module';
import type { Readable, Writable } from 'svelte/store';
import { derived, get, writable } from 'svelte/store';
import { columnOf } from './boards';
import { replayCardDrafts } from './card-draft-recovery';
import { cleanForStorage } from './clean-for-storage';
import { pinItemsFirst } from './collection-todos';
import { todayStart } from './now';
import { consumeFreshAuthorization } from './oauth-state';
import { applyPlan, clearPlan, moveItemToDay, type Plan } from './plan';
import { createRestoring, hasStoredSession } from './restoring';
import rs, { fetchFileBlobUrl } from './rs';
import {
  clearSchedule,
  compareByDueTime,
  isDueTodayOrOverdue,
} from './schedule';
import { showToast } from './toast';

function getInbox() {
  return rs.inbox;
}

/**
 * Like getInbox(), but throws a descriptive error instead of letting callers
 * hit a TypeError on undefined. Used by write paths so a failed module
 * registration surfaces as a clear message rather than a crash mid-operation.
 */
function requireInbox() {
  const inbox = getInbox();
  if (!inbox) throw new Error('Inbox storage module is not available');
  return inbox;
}

/** Blob URLs for files that were just uploaded (available before remote sync completes) */
export const blobUrls = writable<Record<string, string>>({});

/**
 * File paths whose bytes could not be loaded while *connected* — i.e. the
 * remote returned no usable file (a 404, or a fetch error) and there was no
 * local copy either. Distinct from "not loaded yet": a path only lands here
 * after a genuine online failure. Grid cards use it to fall back from a
 * missing thumbnail to the full image (see ImageCard), so a thumb that was
 * never uploaded — or failed its best-effort upload — doesn't leave a
 * permanently blank card when the original image is perfectly fetchable.
 */
export const blobLoadFailures = writable<Set<string>>(new Set());

function markBlobLoadFailed(filePath: string) {
  blobLoadFailures.update((s) => {
    if (s.has(filePath)) return s;
    const next = new Set(s);
    next.add(filePath);
    return next;
  });
}

function clearBlobLoadFailed(filePath: string) {
  blobLoadFailures.update((s) => {
    if (!s.has(filePath)) return s;
    const next = new Set(s);
    next.delete(filePath);
    return next;
  });
}

export const connected = writable(false);
// The cap also bounds the wait for a first sync on a device with no cache.
const startup = createRestoring({
  sessionPending: hasStoredSession(),
  timeoutMs: 8000,
});
/**
 * True on page load until local data has loaded and any stored session has
 * resolved (or ~3s pass). Empty states that depend on `connected` wait for
 * it so a returning user doesn't flash first-run.
 */
export const restoring = startup.restoring;
rs.on('not-connected', startup.sessionSettled);
export const syncing = writable(false);
// Keep the account and local data intact while authorization needs renewal.
export const authorizationRequired = writable(false);
/** The browser's own online/offline signal, independent of the RS connection. */
export const browserOnline = writable(
  typeof navigator === 'undefined' || navigator.onLine,
);
const storageReachable = writable(true);
export const connectionStatus = derived(
  [connected, authorizationRequired, browserOnline, storageReachable, syncing],
  ([
    $connected,
    $authorizationRequired,
    $browserOnline,
    $storageReachable,
    $syncing,
  ]) => {
    if ($authorizationRequired) return 'Reconnect required';
    if (!$connected) return 'Not connected';
    if (!$browserOnline) return 'Offline';
    if (!$storageReachable) return 'Storage unreachable';
    return $syncing ? 'Syncing…' : 'Connected';
  },
);

function readStoredUserAddress(): string {
  try {
    // remoteStorage.js persists the user address in this key
    const settings = JSON.parse(
      localStorage.getItem('remotestorage:wireclient') ?? '{}',
    );
    return (
      settings?.userAddress ??
      localStorage.getItem('inbox-rs:userAddress') ??
      ''
    );
  } catch {
    return '';
  }
}

export const userAddress = writable<string>(readStoredUserAddress());
export const storageHref = writable<string>('');
export const items = writable<Record<string, InboxItem>>({});
/**
 * Un-normalized view of items straight from storage. Used for migration
 * detection so legacy types (e.g. `code-snippet`) are visible to the migrator
 * even though `items` presents them normalized to their current type.
 */
const rawItems = writable<Record<string, object>>({});
export const appConfig = writable<AppConfig>({});
export const userSettings = writable<UserSettings>({});
export { collections } from './collections-store';

import { collections } from './collections-store';
export const groups = writable<Record<string, CollectionGroup>>({});
const INITIAL_MIGRATION_ALERT_TIMEOUT_MS = 2500;

function stripMigrationVersion<T>(doc: T): T {
  if (!doc || typeof doc !== 'object') return doc;
  const { _migrateVersion: _, ...rest } = doc as Record<string, unknown>;
  return rest as T;
}

/**
 * Memoized per document *reference*: `rawItems` entries are replaced (not
 * mutated) whenever an item changes, so identity is a safe cache key. Without
 * this, the derived count below re-runs migrateDocument + two JSON.stringify
 * passes over EVERY item on EVERY change event — during a first sync of N
 * items that's O(N²) (~9M ops at 3k items) and freezes the UI.
 */
const migrationCheckCache = new WeakMap<object, boolean>();

function requiresContentMigration(doc: object): boolean {
  const cached = migrationCheckCache.get(doc);
  if (cached !== undefined) return cached;
  const migrated = migrator.migrateDocument('items', doc as InboxItem);
  const result =
    migrated !== doc &&
    JSON.stringify(stripMigrationVersion(migrated)) !==
      JSON.stringify(stripMigrationVersion(doc));
  migrationCheckCache.set(doc, result);
  return result;
}

/** Count only docs whose non-version content would actually change under migration */
const rawPendingMigrationCount = derived(rawItems, ($rawItems) => {
  const docs = Object.values($rawItems);
  if (docs.length === 0) return 0;
  let count = 0;
  for (const doc of docs) {
    if (requiresContentMigration(doc)) count++;
  }
  return count;
});
const migrationAlertReady = writable(false);
let migrationAlertTimeout: ReturnType<typeof setTimeout> | null = null;

function clearMigrationAlertTimeout() {
  if (!migrationAlertTimeout) return;
  clearTimeout(migrationAlertTimeout);
  migrationAlertTimeout = null;
}

function resetMigrationAlertReadiness() {
  clearMigrationAlertTimeout();
  migrationAlertReady.set(false);
}

function scheduleMigrationAlertFallback() {
  clearMigrationAlertTimeout();
  migrationAlertTimeout = setTimeout(() => {
    migrationAlertTimeout = null;
    migrationAlertReady.set(true);
  }, INITIAL_MIGRATION_ALERT_TIMEOUT_MS);
}

function markMigrationAlertReady() {
  if (get(migrationAlertReady)) return;
  clearMigrationAlertTimeout();
  migrationAlertReady.set(true);
}

/** Visible count for the app after the initial connect/sync state settles */
export const pendingMigrationCount = derived(
  [rawPendingMigrationCount, migrationAlertReady],
  ([$rawPendingMigrationCount, $migrationAlertReady]) =>
    $migrationAlertReady ? $rawPendingMigrationCount : 0,
);

// ---- Generic helpers ----

async function loadEntities<T extends { id: string }>(
  fetchAll: () => Promise<Record<string, unknown>>,
  store: Writable<Record<string, T>>,
  arrayField?: keyof T,
): Promise<boolean> {
  // Callers pass arrow functions that close over the module themselves; the
  // guard only ensures the module registered before we invoke them.
  if (!getInbox()) return false;
  try {
    const all = await fetchAll();
    const valid: Record<string, T> = {};
    for (const [key, raw] of Object.entries(all)) {
      if (raw && typeof raw === 'object' && 'id' in raw && (raw as T).id) {
        const entity = raw as T;
        if (key !== entity.id) continue;
        if (arrayField) {
          valid[key] = {
            ...entity,
            [arrayField]: Array.isArray(entity[arrayField])
              ? entity[arrayField]
              : [],
          };
        } else {
          valid[key] = entity;
        }
      }
    }
    // Merge into the store rather than replacing — the change handler may
    // have already inserted entries during the await window, and a .set()
    // would silently drop them.
    store.update((current) => ({ ...current, ...valid }));
    return true;
  } catch (e) {
    console.error('[inbox] loadEntities failed:', e);
    return false;
  }
}

function orderedDerived<T extends { id: string; createdAt: string }>(
  entityStore: Readable<Record<string, T>>,
  configOrderKey: 'collectionsOrder' | 'groupsOrder',
): Readable<T[]> {
  return derived([entityStore, appConfig], ([$entities, $config]) => {
    return sortWithConfiguredOrder(
      Object.values($entities),
      $config[configOrderKey],
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  });
}

/**
 * Weave a reordered subset back into a stored order, leaving ids the caller
 * never saw where they already were.
 *
 * Every list a user drags is a *filtered* view: archived collections are
 * absent from `groupCollections`, archived groups from `sortedGroups`, and the
 * Collections page additionally hides whatever the filter row has switched
 * off. Persisting the dragged list verbatim would silently evict all of those
 * from the stored order, so a later unarchive or filter-clear would find them
 * dumped at the end.
 *
 * So: each slot in `existing` that held a *visible* id is refilled from
 * `newOrder` in turn, and slots held by ids the caller couldn't see keep their
 * occupant. Ids in `newOrder` with no slot yet (a collection reachable through
 * `groupId` but missing from `collectionIds`) are appended.
 */
export function spliceIntoOrder(
  existing: readonly string[],
  newOrder: readonly string[],
): string[] {
  const incoming = new Set(newOrder);
  const queue = [...newOrder];
  const result: string[] = [];
  for (const id of existing) {
    if (!incoming.has(id)) {
      result.push(id);
      continue;
    }
    const next = queue.shift();
    if (next !== undefined) result.push(next);
  }
  result.push(...queue);
  return result;
}

async function removeFromOrderConfig(
  id: string,
  key: 'collectionsOrder' | 'groupsOrder',
) {
  const currentOrder = get(appConfig)[key] ?? [];
  if (currentOrder.includes(id)) {
    await updateConfig({ [key]: currentOrder.filter((x: string) => x !== id) });
  }
}

// ---- Loaders ----

function normalizeLoadedItem(item: object): InboxItem {
  const candidate = item as Record<string, unknown>;
  if (candidate.type === 'code-snippet') {
    const { language, body, ...rest } = candidate;
    return {
      ...rest,
      type: 'note',
      body: wrapCodeBlock(body, language),
    } as InboxItem;
  }
  return candidate as unknown as InboxItem;
}

async function loadItems() {
  const inbox = getInbox();
  if (!inbox) {
    console.warn('[inbox] loadItems: inbox module not available');
    return;
  }
  try {
    const all = await inbox.getAll();
    const valid: Record<string, InboxItem> = {};
    const rawValid: Record<string, object> = {};
    for (const [key, item] of Object.entries(all)) {
      if (
        item &&
        typeof item === 'object' &&
        'id' in item &&
        typeof (item as { id?: unknown }).id === 'string'
      ) {
        // Only trust canonically-addressed item records. This avoids rendering
        // duplicate/stale documents that may still exist under malformed keys.
        if (key !== (item as { id: string }).id) continue;
        rawValid[key] = item;
        valid[key] = normalizeLoadedItem(item);
      }
    }
    // Merge rather than overwrite. The RS change handler can populate `items`
    // optimistically (via 'local' cache-replay events) before getAll() resolves;
    // calling .set() with the getAll result would clobber any items that were
    // added by storeItem() while we were awaiting. We trust getAll's snapshot
    // for entries it returned, but preserve any keys it didn't.
    rawItems.update((current) => ({ ...current, ...rawValid }));
    items.update((current) => ({ ...current, ...valid }));
  } catch (e) {
    console.error('[inbox] loadItems failed:', e);
  }
}

// Edits the card editor couldn't push before the app was closed sit in
// localStorage. Write them once a load has settled — not from inside
// loadItems, where a concurrent getAll() could read the pre-write cache and
// then merge that stale snapshot over the replayed item in the store.
let draftReplay: Promise<void> | null = null;
function replayPendingCardDrafts(): Promise<void> {
  if (typeof localStorage === 'undefined') return Promise.resolve();
  if (draftReplay) return draftReplay;
  draftReplay = replayCardDrafts(get(items), localStorage, (item) =>
    storeItem(item),
  )
    .then(() => undefined)
    .catch((e) => console.error('[inbox] card draft replay failed:', e))
    .finally(() => {
      draftReplay = null;
    });
  return draftReplay;
}

async function loadConfig() {
  const inbox = getInbox();
  if (!inbox) return;
  try {
    const config = await inbox.getConfig();
    if (config && typeof config === 'object') {
      appConfig.set(config);
    }
  } catch (e) {
    console.error('[inbox] loadConfig failed:', e);
  }
}

async function loadUserSettings() {
  const inbox = getInbox();
  if (!inbox) return;
  try {
    const settings = await inbox.getUserSettings();
    if (settings && typeof settings === 'object') {
      userSettings.set(settings);
    }
  } catch (e) {
    console.error('[inbox] loadUserSettings failed:', e);
  }
}

async function loadCollections() {
  const inbox = getInbox();
  return loadEntities<Collection>(
    () => inbox.getAllCollections(),
    collections,
    'itemIds',
  );
}

async function loadGroups() {
  const inbox = getInbox();
  return loadEntities<CollectionGroup>(
    () => inbox.getAllGroups(),
    groups,
    'collectionIds',
  );
}

// Single in-flight load promise so the cached preload (queueMicrotask at
// module init) and the post-connect reload don't run concurrent loaders
// against the same five stores. Each entry-point waits for any pending load
// to settle before kicking off its own.
let inFlightLoad: Promise<void> | null = null;

function runLoaders(): Promise<void> {
  return Promise.all([
    loadItems(),
    loadConfig(),
    loadUserSettings(),
    loadCollections(),
    loadGroups(),
  ])
    .then(() => undefined)
    .finally(startup.localLoaded);
}

async function loadCachedData() {
  // Skip if the connect handler has already taken over — its load is
  // authoritative once we're online.
  if (get(connected)) return;
  if (inFlightLoad) {
    await inFlightLoad;
    return;
  }
  inFlightLoad = runLoaders();
  try {
    await inFlightLoad;
    markMigrationAlertReady();
  } finally {
    inFlightLoad = null;
  }
  await replayPendingCardDrafts();
}

async function loadConnectedData() {
  resetMigrationAlertReadiness();
  if (inFlightLoad) {
    // Let the cached load settle before starting a fresh one so we don't
    // double-read the same stores in parallel.
    try {
      await inFlightLoad;
    } catch {
      /* errors handled inside loaders */
    }
  }
  inFlightLoad = runLoaders();
  try {
    await inFlightLoad;
    scheduleMigrationAlertFallback();
  } finally {
    inFlightLoad = null;
  }
  await replayPendingCardDrafts();
}

// Debounced sync indicator: stays visible for at least 1 second to avoid flicker
let syncTimeout: ReturnType<typeof setTimeout> | null = null;
let syncVisibleUntil = 0;

/** Show sync activity only while storage can receive requests. */
function showSync() {
  if (
    get(authorizationRequired) ||
    !get(browserOnline) ||
    !get(storageReachable)
  )
    return;
  syncing.set(true);
  syncVisibleUntil = Date.now() + 1000;
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = null;
}

function hideSync() {
  const remaining = syncVisibleUntil - Date.now();
  if (remaining > 0) {
    if (!syncTimeout) {
      syncTimeout = setTimeout(() => {
        syncTimeout = null;
        syncing.set(false);
      }, remaining);
    }
  } else {
    syncing.set(false);
  }
}

/** Clear pending sync UI when authorization or connectivity is lost. */
function stopSyncIndicator() {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = null;
  syncVisibleUntil = 0;
  syncing.set(false);
}

// Browser connectivity updates immediately; RS events also detect a server
// that is unreachable even while the device itself remains online.
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    browserOnline.set(false);
    stopSyncIndicator();
  });
  window.addEventListener('online', () => browserOnline.set(true));
}
rs.on('network-offline', () => {
  storageReachable.set(false);
  stopSyncIndicator();
});
rs.on('network-online', () => storageReachable.set(true));

rs.on('wire-busy', showSync);
rs.on('wire-done', () => {
  hideSync();
  markMigrationAlertReady();
});
rs.on('sync-done', () => {
  if (awaitingFirstSync) {
    awaitingFirstSync = false;
    // Synced items sit in the change buffer briefly; land them first.
    flushPendingItemChanges();
    startup.sessionSettled();
  }
  hideSync();
  markMigrationAlertReady();
});

rs.on('error', (e: unknown) => {
  startup.sessionSettled();
  console.warn('[inbox] rs:error', e);
  if (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    e.name === 'Unauthorized'
  ) {
    syncing.set(false);
    if ('code' in e && e.code === 'access_denied') {
      // OAuth callbacks pass per-tab state validation in rs.ts before RS sees
      // them. Only a matching denial may take this destructive cleanup path.
      rs.disconnect();
    } else {
      authorizationRequired.set(true);
    }
  }
});

// An empty cache on connect may just not have synced yet, so the startup
// "restoring" state holds until the first sync (or its safety timeout).
let awaitingFirstSync = false;

rs.on('connected', async () => {
  awaitingFirstSync = true;
  storageReachable.set(true);
  authorizationRequired.set(false);
  connected.set(true);
  // The connected user's address lives on `rs.remote` once auth completes;
  // fall back to localStorage so we have something to display before sync.
  const remote = rs.remote as
    | { userAddress?: string; href?: string }
    | undefined;
  const addr =
    remote?.userAddress || localStorage.getItem('inbox-rs:userAddress') || '';
  userAddress.set(addr);
  storageHref.set(remote?.href || '');
  // Confirm a connect the user just made; a reload that resumes a stored
  // session stays quiet.
  if (consumeFreshAuthorization() && addr) showToast(`Connected as ${addr}`);
  try {
    await loadConnectedData();
  } finally {
    if (Object.keys(get(items)).length > 0) startup.sessionSettled();
  }
});

rs.on('disconnected', () => {
  startup.sessionSettled();
  stopSyncIndicator();
  storageReachable.set(true);
  authorizationRequired.set(false);
  // Revoke all blob URLs to prevent memory leaks across reconnects / long sessions.
  // Bump the generation so any in-flight loadFileBlobUrl promises from
  // before this disconnect are ignored when they resolve (prevents stale
  // blob URLs from being re-added after cleanup).
  blobLoadGeneration++;
  const currentBlobs = get(blobUrls);
  for (const url of Object.values(currentBlobs)) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore revoke errors during shutdown
    }
  }
  blobUrls.set({});
  blobLruOrder.length = 0;
  pendingBlobLoads.clear();
  revokedBlobPaths.clear();

  connected.set(false);
  userAddress.set('');
  storageHref.set('');
  localStorage.removeItem('inbox-rs:userAddress');
  clearMigrationAlertTimeout();
  migrationAlertReady.set(false);
  items.set({});
  rawItems.set({});
  appConfig.set({});
  userSettings.set({});
  collections.set({});
  groups.set({});
});

// Wait for `ready` before getAll() — earlier calls sit in `_pendingGPD`
// until features finish loading, which means a stalled IDB init drags the
// preload into its 10s timeout even with `maxAge: false`. RS replays `ready`
// for late listeners, so HMR still triggers this on module re-run.
rs.on('ready', () => {
  void loadCachedData();
});

export async function runAllMigrations() {
  const inbox = getInbox();
  if (!inbox) return;
  try {
    await inbox.runAllMigrations();
  } catch (e) {
    console.error('[inbox] migration failed:', e);
  }
  await loadItems();
}

export async function updateConfig(patch: Partial<AppConfig>) {
  const inbox = getInbox();
  if (!inbox) throw new Error('Cannot update config: storage not connected');
  const currentConfig = get(appConfig);
  const updated = { ...currentConfig, ...patch };
  appConfig.set(updated);
  try {
    await inbox.setConfig(cleanForStorage(updated));
  } catch (e) {
    appConfig.set(currentConfig);
    console.error('[inbox] failed to persist config update:', e);
    throw e;
  }
}

export async function updateUserSettings(patch: Partial<UserSettings>) {
  const inbox = getInbox();
  if (!inbox)
    throw new Error('Cannot update user settings: storage not connected');
  const current = get(userSettings);
  const updated = { ...current, ...patch };
  userSettings.set(updated);
  try {
    await inbox.setUserSettings(cleanForStorage(updated));
  } catch (e) {
    userSettings.set(current);
    console.error('[inbox] failed to persist user settings:', e);
    throw e;
  }
}

// Handle incoming remote changes per-item rather than reloading full
// collections with getAll(). RS.js fires a `change` event for each item
// during a sync cycle — we parse relativePath to route each change to the
// correct store. This avoids redundant cache reads when many items arrive
// at once (e.g. bulk image sync from another device).
//
// Local writes already update stores optimistically (see storeItem,
// deleteItem, etc.), so we skip 'window' origin events to avoid duplicates.
// getAll() is only used for the initial load on connect.
//
// See: https://remotestorage.io/rs.js/docs/api/baseclient/classes/BaseClient.html#change-events
const inboxRef = getInbox();
/**
 * Applies remote item changes still waiting in the change buffer. A no-op
 * until storage is connected (the buffer lives in the connection block).
 */
let flushPendingItemChanges: () => void = () => {};

if (inboxRef) {
  // The change event payload is documented in remotestoragejs but typed as
  // `unknown` on the public API. Narrow to the fields we actually read.
  type ChangeEvent = {
    origin?: string;
    relativePath?: string;
    newValue?: unknown;
  };
  // Item change events are buffered and flushed as ONE store update per
  // window. RS fires a separate `change` event for every item a sync cycle
  // delivers; applying each one individually spreads the whole `items`
  // record and re-runs every derived store (sortedItems sort, collectionItems
  // rebuild, migration recount) per event — O(N²) during a bulk sync. A 50ms
  // window coalesces a sync burst into a handful of updates while staying
  // imperceptible for a single incoming change. Collections/groups/config
  // change rarely and are still applied immediately below.
  type PendingItemChange = {
    value: object | null; // null = delete
    /** RS event origin: 'local' is the startup cache replay. */
    origin: string | undefined;
  };
  const pendingItemChanges = new Map<string, PendingItemChange>();
  let itemFlushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushItemChanges() {
    itemFlushTimer = null;
    if (pendingItemChanges.size === 0) return;
    const batch = new Map(pendingItemChanges);
    pendingItemChanges.clear();
    // 'local' events are the cache being read back at startup. They exist to
    // paint the grid before getAll() resolves; they are never fresher than
    // what the store already holds, and the 50ms buffer can deliver them
    // *after* a write that happened in the meantime (a replayed card draft),
    // which would then be overwritten with the pre-write value. Only let
    // them fill gaps.
    const present = get(items);
    for (const [key, change] of batch) {
      if (change.origin === 'local' && present[key]) batch.delete(key);
    }
    if (batch.size === 0) return;
    rawItems.update((current) => {
      const next = { ...current };
      for (const [key, { value }] of batch) {
        if (value) next[key] = value;
        else delete next[key];
      }
      return next;
    });
    items.update((current) => {
      const next = { ...current };
      for (const [key, { value }] of batch) {
        if (value) next[key] = normalizeLoadedItem(value);
        else delete next[key];
      }
      return next;
    });
  }

  flushPendingItemChanges = () => {
    if (itemFlushTimer !== null) clearTimeout(itemFlushTimer);
    flushItemChanges();
  };

  function queueItemChange(
    key: string,
    value: object | null,
    origin: string | undefined,
  ) {
    pendingItemChanges.set(key, { value, origin });
    if (itemFlushTimer === null) {
      itemFlushTimer = setTimeout(flushItemChanges, 50);
    }
  }

  inboxRef.onChange((rawEvent: unknown) => {
    const event = rawEvent as ChangeEvent;
    if (!event || event.origin === 'window') return;
    const path: string = event.relativePath || '';
    const value = event.newValue;

    if (path.startsWith('items/')) {
      const key = path.slice('items/'.length);
      if (value && typeof value === 'object' && 'id' in value) {
        if (key !== (value as { id: string }).id) return;
        queueItemChange(key, value, event.origin);
      } else if (!value) {
        queueItemChange(key, null, event.origin);
      }
    } else if (path.startsWith('collections/')) {
      const key = path.slice('collections/'.length);
      if (value && typeof value === 'object' && 'id' in value) {
        const col = value as Collection;
        // Normalize itemIds — may be missing if written by another client
        collections.update((current) => ({
          ...current,
          [key]: {
            ...col,
            itemIds: Array.isArray(col.itemIds) ? col.itemIds : [],
          },
        }));
      } else if (!value) {
        collections.update((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    } else if (path.startsWith('groups/')) {
      const key = path.slice('groups/'.length);
      if (value && typeof value === 'object' && 'id' in value) {
        const grp = value as CollectionGroup;
        // Normalize collectionIds — may be missing if written by another client
        groups.update((current) => ({
          ...current,
          [key]: {
            ...grp,
            collectionIds: Array.isArray(grp.collectionIds)
              ? grp.collectionIds
              : [],
          },
        }));
      } else if (!value) {
        groups.update((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    } else if (path === 'config/app') {
      if (value && typeof value === 'object') {
        appConfig.set(value as AppConfig);
      }
    } else if (path === 'config/user') {
      if (value && typeof value === 'object') {
        userSettings.set(value as UserSettings);
      }
    }
    // File paths (e.g. files/photo.jpg) are ignored here — binary data
    // is fetched on demand via loadFileBlobUrl when components render.
  });
}

// Request a check for remote changes when the tab returns to foreground.
// This is the correct use of startSync() — local writes push automatically,
// but we need to explicitly ask for remote changes after being backgrounded.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && rs.remote?.connected) {
    rs.startSync();
  }
});

function sortWithConfiguredOrder<T extends { id: string }>(
  entities: T[],
  order: string[] | undefined,
  fallbackCompare: (a: T, b: T) => number,
): T[] {
  const orderIndex = order?.length
    ? new Map(order.map((id, index) => [id, index]))
    : undefined;

  // Sort a copy — callers hold references to the arrays they pass in, and an
  // in-place sort here is an easy source of accidental store mutation.
  return [...entities].sort((a, b) => {
    if (orderIndex) {
      const aIndex = orderIndex.get(a.id);
      const bIndex = orderIndex.get(b.id);
      if (aIndex !== undefined || bIndex !== undefined) {
        if (aIndex === undefined) return 1;
        if (bIndex === undefined) return -1;
        if (aIndex !== bIndex) return aIndex - bIndex;
      }
    }

    return fallbackCompare(a, b);
  });
}

// ---- Derived stores ----

// Placement semantics:
//   - item.collectionId set: item is filed in that real collection.
//   - reference item without collectionId: item lives in Inbox.
//   - todo without collectionId: item is unfiled and appears on the Todos page.
// There is no automatic collection/group bucket for unfiled items.

/** Inbox reference items: non-todos with no collectionId. */
export const sortedItems = derived(items, ($items) => {
  return pinItemsFirst(
    Object.values($items)
      .filter(
        (i) => !i.isTodo && i.type !== 'todo' && !i.collectionId && !i.archived,
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
  );
});

/**
 * Inbox reference cards archived by adding them to a calendar — triage
 * complete, the calendar owns them. Shown in the Inbox's collapsed archived
 * section (newest archive first); removing the calendar entry un-archives.
 */
export const archivedItems = derived(items, ($items) => {
  return Object.values($items)
    .filter(
      (i) => !i.isTodo && i.type !== 'todo' && !i.collectionId && !!i.archived,
    )
    .sort(
      (a, b) =>
        new Date(b.archivedAt ?? b.createdAt).getTime() -
        new Date(a.archivedAt ?? a.createdAt).getTime(),
    );
});

/**
 * Unfiled todos — every todo without a `collectionId`. Sorted open-first (respecting
 * `todosGlobalOrder`) then completed (by `completedAt` desc).
 *
 * `todosGlobalOrder` is the single source of truth for todo ordering across
 * the flat `/todos` page. Reordering unfiled todos from a focused surface goes
 * through `reorderUnfiledTodos`, which splices only unfiled slots so the filed
 * todos keep their global positions.
 *
 * Named `todoItems` for backwards compatibility with callers
 * (CollectionItemPicker, test suite) that use this store for unfiled todos.
 */
export const todoItems = derived(
  [items, appConfig, todayStart],
  ([$items, $config, $todayStart]) => {
    const all = Object.values($items).filter(
      (i) => (i.isTodo || i.type === 'todo') && !i.collectionId && !i.archived,
    );
    const completed = all.filter((i) => i.completed);

    const open = pinDueTodos(
      pinItemsFirst(
        sortWithConfiguredOrder(
          all.filter((i) => !i.completed),
          $config.todosGlobalOrder,
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
      ),
      $todayStart,
    );

    // Completed sorted by completedAt desc
    completed.sort(
      (a, b) =>
        new Date(b.completedAt ?? b.createdAt).getTime() -
        new Date(a.completedAt ?? a.createdAt).getTime(),
    );

    return [...open, ...completed];
  },
);

export const collectionItems = derived(
  [items, collections],
  ([$items, $collections]) => {
    const result: Record<string, InboxItem[]> = {};
    const itemMap = new Map(Object.values($items).map((i) => [i.id, i]));
    // Items filed into a collection that never made it into its itemIds —
    // the item is stored pre-filed and the collection write failed or has
    // not arrived by sync yet. Listed after the ordered ones so they show
    // somewhere rather than in no view at all.
    const stragglers: Record<string, InboxItem[]> = {};
    for (const i of itemMap.values()) {
      if (!i.collectionId) continue;
      (stragglers[i.collectionId] ??= []).push(i);
    }
    for (const [cid, col] of Object.entries($collections)) {
      const ordered = col.itemIds
        .map((id) => itemMap.get(id))
        .filter(
          (i): i is InboxItem => i !== undefined && i.collectionId === cid,
        );
      const listed = new Set(ordered.map((i) => i.id));
      result[cid] = [
        ...ordered,
        ...(stragglers[cid] ?? []).filter((i) => !listed.has(i.id)),
      ];
    }
    return result;
  },
);

// ---- File blob URL loading ----

/** Incremented on full blob URL revocation (e.g. disconnect) to invalidate in-flight loads. */
let blobLoadGeneration = 0;
const pendingBlobLoads = new Map<string, number>();

/**
 * Cap on how many blob URLs stay alive at once. Each entry pins the file's
 * full bytes in memory, and nothing else ever revokes them during a session —
 * a long browse through a media-heavy inbox would otherwise accumulate
 * hundreds of MB. Evicted paths simply reload on next view (cheap: the bytes
 * stay in the RS local cache, only the in-memory Blob is dropped). The cap is
 * generous enough that anything on screen — including the Lightbox's current
 * image — is effectively never the eviction victim.
 */
const BLOB_CACHE_MAX = 150;
/** filePaths in least-recently-used order (most recent last). */
const blobLruOrder: string[] = [];

function touchBlobLru(filePath: string) {
  const i = blobLruOrder.indexOf(filePath);
  if (i >= 0) blobLruOrder.splice(i, 1);
  blobLruOrder.push(filePath);
  while (blobLruOrder.length > BLOB_CACHE_MAX) {
    const evict = blobLruOrder.shift();
    if (!evict) break;
    const url = get(blobUrls)[evict];
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
      blobUrls.update((current) => {
        const next = { ...current };
        delete next[evict];
        return next;
      });
    }
  }
}

function dropBlobLru(filePath: string) {
  const i = blobLruOrder.indexOf(filePath);
  if (i >= 0) blobLruOrder.splice(i, 1);
}
/** Paths for which we have explicitly revoked (via deleteItem) so in-flight loads don't re-insert. */
const revokedBlobPaths = new Set<string>();

/**
 * Resolve a file's bytes to a blob URL from the best available source.
 *
 * When connected we fetch from the remote over authenticated HTTP. Otherwise —
 * or when the remote 404s because the file was captured offline and hasn't
 * synced yet — we read it from the local remoteStorage cache, where `store()`
 * writes the bytes regardless of connection state. Without this fallback, files
 * captured while disconnected vanish on reload even though their bytes (and
 * metadata) are sitting in the cache.
 */
async function resolveFileBlobUrl(
  filePath: string,
  mimeType?: string,
): Promise<string | null> {
  // Network first when connected. We deliberately do NOT read remoteStorage's
  // local cache before the remote for binaries: remotestorage.js's sync layer
  // corrupts a *remotely-fetched* binary body by running it through a
  // non-fatal UTF-8 decode, so bytes like 0x89 (a PNG's first byte) come back
  // as U+FFFD (0xFD) with the length shifted. The loss is not recoverable
  // (`recoverLegacyBinaryStringEncoding` only reverses the lossless legacy
  // shapes), so a device that never *wrote* the file itself — i.e. any device
  // other than the one that captured it — would render a broken image from
  // cache. `fetchFileWithAuth` reads the raw response bytes and is always
  // faithful. The extra fetch is deduped within a session by the in-memory
  // `blobUrls` LRU cache, so a given path is only fetched once per session.
  if (get(connected)) {
    const url = await fetchFileBlobUrl(filePath, mimeType);
    if (url) return url;
  }
  // Offline, or the remote 404'd because the file was captured on this device
  // and hasn't synced yet: read the local cache, where `store()` writes the
  // bytes regardless of connection state. This copy is faithful because *we*
  // wrote the raw ArrayBuffer into it — it never went through the sync layer's
  // corrupting decode. Without this fallback, offline-captured files would
  // vanish on reload even though their bytes are sitting in the cache.
  const inbox = getInbox();
  if (inbox) {
    try {
      const cached = await inbox.getFile(filePath);
      if (cached?.data) {
        // Prefer the caller's mimeType, and strip any `; charset=...` suffix
        // from the cached type — files pulled from the remote by the sync
        // layer can carry 5apps' `; charset=binary` echo, which Chrome
        // refuses to render as an <img> blob.
        const cleanType =
          mimeType?.trim() ||
          (cached.mimeType || '').split(';')[0].trim() ||
          '';
        const blob = new Blob([cached.data], { type: cleanType });
        return URL.createObjectURL(blob);
      }
    } catch {
      // No cached copy either — give up (returns null → placeholder).
    }
  }
  return null;
}

/**
 * Fetch a file and create a blob URL, stored in blobUrls for reactive display.
 * No-ops if already loaded or in progress. Components should call this on mount.
 * Reads from the remote when connected, otherwise from the local cache (see
 * resolveFileBlobUrl) so offline-captured files still render.
 *
 * A generation number is captured at start time. After a disconnect (or other
 * full revocation), the generation is bumped so stale promises cannot
 * re-populate blobUrls with URLs created after cleanup.
 */
export function loadFileBlobUrl(filePath: string, mimeType?: string): void {
  if (!filePath) return;
  // A new explicit load attempt clears any prior delete tombstone for this path.
  revokedBlobPaths.delete(filePath);
  if (get(blobUrls)[filePath] || pendingBlobLoads.has(filePath)) return;
  const gen = blobLoadGeneration;
  pendingBlobLoads.set(filePath, gen);
  resolveFileBlobUrl(filePath, mimeType)
    .then((url) => {
      if (!url) {
        // A null result while connected is a genuine failure (remote 404 or
        // fetch error, and no local copy) — record it so grid cards can fall
        // back from a missing thumbnail to the full image. While offline it
        // just means "not available yet"; the `$connected` re-run retries.
        if (get(connected)) markBlobLoadFailed(filePath);
        return;
      }
      clearBlobLoadFailed(filePath);
      // Ignore (and revoke) results that are stale due to disconnect, delete, etc.
      if (
        pendingBlobLoads.get(filePath) !== gen ||
        revokedBlobPaths.has(filePath)
      ) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
        return;
      }
      const old = get(blobUrls)[filePath];
      if (old) URL.revokeObjectURL(old);
      blobUrls.update((current) => ({ ...current, [filePath]: url }));
      touchBlobLru(filePath);
    })
    .finally(() => {
      if (pendingBlobLoads.get(filePath) === gen) {
        pendingBlobLoads.delete(filePath);
      }
    });
}

// ---- Item operations ----

/**
 * Per-item operation queues. Every write, delete or read-merge-write for an
 * item runs after the ones queued before it, so a reader never merges
 * against `items` while a save for that id is still landing.
 */
const itemQueues = new Map<string, Promise<unknown>>();

/** Run `op` once every earlier op for `id` has settled. */
export function runForItem<T>(id: string, op: () => Promise<T>): Promise<T> {
  // Start at once when nothing is queued: a pagehide flush must begin its
  // write before the page unloads, so it can't wait a microtask. `prev` is
  // already error-swallowed, so one failed op rejects only its own caller.
  const prev = itemQueues.get(id);
  const run = prev ? prev.then(op) : op();
  const settled = run.catch(() => {});
  itemQueues.set(id, settled);
  settled.then(() => {
    if (itemQueues.get(id) === settled) itemQueues.delete(id);
  });
  return run;
}

export function storeItem(
  item: InboxItem,
  fileData?: ArrayBuffer,
  thumbData?: ArrayBuffer,
): Promise<void> {
  return runForItem(item.id, () => writeItem(item, fileData, thumbData));
}

/**
 * Read the live item inside its queue and write what `update` returns —
 * nothing when it returns null (item gone, or no change). No other save for
 * the id can land between the read and the write.
 */
export function updateItem<T extends InboxItem>(
  id: string,
  update: (current: InboxItem | undefined) => T | null,
): Promise<T | null> {
  return runForItem(id, async () => {
    const next = update(get(items)[id]);
    if (next) await writeItem(next);
    return next;
  });
}

async function writeItem(
  item: InboxItem,
  fileData?: ArrayBuffer,
  thumbData?: ArrayBuffer,
) {
  const inbox = requireInbox();
  const cleanItem = cleanForStorage(item);
  await inbox.store(cleanItem, fileData, thumbData);
  if (fileData && 'filePath' in item && item.filePath && 'mimeType' in item) {
    const blob = new Blob([fileData], {
      type: (item as { mimeType?: string }).mimeType,
    });
    const url = URL.createObjectURL(blob);
    blobUrls.update((current) => ({
      ...current,
      [item.filePath as string]: url,
    }));
    touchBlobLru(item.filePath as string);
  }
  // Register the freshly generated thumbnail too, so the grid card shows it
  // immediately without a round trip through the loader.
  if (thumbData && 'thumbPath' in item && item.thumbPath) {
    const url = URL.createObjectURL(
      new Blob([thumbData], {
        type: (item as { thumbMimeType?: string }).thumbMimeType,
      }),
    );
    blobUrls.update((current) => ({
      ...current,
      [item.thumbPath as string]: url,
    }));
    touchBlobLru(item.thumbPath as string);
  }
  rawItems.update((current) => ({
    ...current,
    [cleanItem.id]: cleanItem as object,
  }));
  items.update((current) => ({ ...current, [cleanItem.id]: cleanItem }));
}

/** Toggle an item's top-of-list priority while preserving every other field. */
export async function setItemPinned(item: InboxItem, pinned: boolean) {
  // Write from the stored item: rows may pass a display copy (e.g. a list's
  // Someday row carries a view-only planKind) that mustn't be saved.
  flushPendingItemChanges();
  // Read inside the queue: a save still landing must not be overwritten,
  // and a delete queued ahead of us must not be undone (null = gone).
  await updateItem(item.id, (current) =>
    current ? { ...current, pinned } : null,
  );
}

/**
 * Give an item a soft plan ("roughly when"), or clear it with `null`.
 * `changes` are applied on top of the latest stored copy in the same write.
 * A soft plan and a real date are mutually exclusive: planning drops the
 * date (and, like "Remove time", the local calendar receipt — the calendar
 * keeps its entry). Pins are left alone; a plan simply outranks them when
 * the Todos page decides where the todo sits.
 */
export async function setItemPlan(
  target: InboxItem,
  plan: Plan | null,
  changes: Partial<InboxItem> = {},
) {
  // Apply any remote edits still sitting in the 50 ms change buffer, then
  // build on the freshest copy, so this write can't roll them back.
  flushPendingItemChanges();
  const item = {
    ...(get(items)[target.id] ?? target),
    ...changes,
  } as InboxItem;
  let base = plan && item.startsAt ? clearSchedule(item) : item;
  // clearSchedule also lifts calendar-owned archiving; a card the user
  // archived by hand stays archived.
  if (base !== item && item.archived && item.archiveReason === 'manual') {
    base = {
      ...base,
      archived: item.archived,
      archivedAt: item.archivedAt,
      archiveReason: item.archiveReason,
    };
  }
  await storeItem(plan ? applyPlan(base, plan) : clearPlan(base));
}

/**
 * Move an item to another day, keeping its kind, time and length. Like
 * setItemPlan, it builds on the freshest copy so buffered remote edits
 * aren't rolled back by the write.
 */
export async function moveStoredItemToDay(target: InboxItem, day: Date) {
  flushPendingItemChanges();
  await storeItem(moveItemToDay(get(items)[target.id] ?? target, day));
}

/**
 * Apply any remote edits still waiting in the 50 ms change buffer, so a
 * read of `items` that follows sees them. For actions outside this module
 * that read a card before writing it.
 */
export function flushItemChanges(): void {
  flushPendingItemChanges();
}

/** A card before and after a triage write — what an undo needs. */
export interface TriageChange {
  before: InboxItem;
  after: InboxItem;
}

/**
 * Turn an inbox card into an unfiled todo, planned for a horizon or dated
 * for a day, in one write. Like the Todos page's own conversion it drops
 * any calendar receipt and treats an existing time as a task's. Builds on
 * the freshest copy and returns it with the stored result, for undo.
 */
export async function triageToTodo(
  target: InboxItem,
  when: { plan: Plan } | { day: Date },
): Promise<TriageChange> {
  flushPendingItemChanges();
  const before = get(items)[target.id] ?? target;
  const todo: Record<string, unknown> = {
    ...before,
    isTodo: true,
    completed: false,
  };
  for (const key of [
    'completedAt',
    'eventUrl',
    'eventEtag',
    'archived',
    'archivedAt',
    'archiveReason',
    // Event-only; the task is live.
    'cancelled',
  ]) {
    delete todo[key];
  }
  if (todo.startsAt) todo.scheduleKind = 'task';
  let next = todo as unknown as InboxItem;
  if ('day' in when) {
    next = moveItemToDay(next, when.day);
  } else {
    next = applyPlan(next.startsAt ? clearSchedule(next) : next, when.plan);
  }
  await storeItem(next);
  return { before, after: get(items)[target.id] ?? next };
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** Keep a collection's itemIds in step with an item that changed collection. */
async function moveMembership(
  itemId: string,
  from: string | undefined,
  to: string | undefined,
) {
  const inbox = requireInbox();
  for (const [colId, add] of [
    [from, false],
    [to, true],
  ] as const) {
    if (!colId) continue;
    const col = get(collections)[colId];
    if (!col || col.itemIds.includes(itemId) === add) continue;
    const updated = {
      ...col,
      itemIds: add
        ? [...col.itemIds, itemId]
        : col.itemIds.filter((id) => id !== itemId),
    };
    collections.update((current) => ({ ...current, [colId]: updated }));
    await inbox.storeCollection(cleanForStorage(updated));
  }
}

/**
 * Undo a triage write. Re-reads the card and puts back only the fields the
 * action changed and nobody has touched since, so an edit that synced in
 * after the action survives. The card is written once; if it changes
 * collection, only the collections' membership lists are written after it.
 * Returns false when the card no longer exists.
 */
export async function restoreItem(change: TriageChange): Promise<boolean> {
  flushPendingItemChanges();
  const { before, after } = change;
  const current = get(items)[before.id];
  if (!current) return false;
  const restored: Record<string, unknown> = { ...current };
  const was = before as unknown as Record<string, unknown>;
  const did = after as unknown as Record<string, unknown>;
  const now = current as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(was), ...Object.keys(did)])) {
    if (sameValue(was[key], did[key])) continue; // the action left it alone
    if (!sameValue(now[key], did[key])) continue; // edited since: keep it
    if (was[key] === undefined) delete restored[key];
    else restored[key] = was[key];
  }
  // The old collection was deleted meanwhile: land in the inbox, not nowhere.
  const target = restored.collectionId as string | undefined;
  if (target && !get(collections)[target]) delete restored.collectionId;
  await storeItem(restored as unknown as InboxItem);
  await moveMembership(
    before.id,
    current.collectionId,
    restored.collectionId as string | undefined,
  );
  return true;
}

/** Favourite collection ids that still exist and aren't archived, in the user's order. */
export const favoriteCollectionIds = derived(
  [appConfig, collections, groups],
  ([$config, $collections, $groups]) =>
    ($config.favoriteCollectionIds ?? []).filter((id) => {
      const col = $collections[id];
      // Archiving a group doesn't flag its collections, so check the group
      // too. The saved id stays, so un-archiving brings the favourite back.
      return (
        !!col &&
        !col.archived &&
        !(col.groupId && $groups[col.groupId]?.archived)
      );
    }),
);

/** Favourite collections themselves, in the user's order. */
export const favoriteCollections = derived(
  [favoriteCollectionIds, collections],
  ([$ids, $collections]) => $ids.map((id) => $collections[id]),
);

/** Add or remove a collection from favourites. New favourites go last. */
export async function toggleFavoriteCollection(id: string) {
  const current = get(appConfig).favoriteCollectionIds ?? [];
  await updateConfig({
    favoriteCollectionIds: current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id],
  });
}

/**
 * Revoke and forget a single stored file's in-memory blob URL, and clear its
 * LRU / in-flight / revoked bookkeeping. Shared by deleteItem and removeFile.
 */
function releaseBlobPath(path: string) {
  const existing = get(blobUrls)[path];
  if (existing) {
    try {
      URL.revokeObjectURL(existing);
    } catch {
      // ignore
    }
    blobUrls.update((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
  }
  dropBlobLru(path);
  // Drop any in-flight load for this specific file (no global gen bump needed).
  pendingBlobLoads.delete(path);
  // Mark as revoked so a concurrent in-flight load for this exact path is
  // ignored on resolution.
  revokedBlobPaths.add(path);
}

/**
 * Delete a single stored file by path (e.g. an orphaned thumbnail left behind
 * when an image edit produced no new thumbnail) and release its blob URL.
 * Best-effort: a storage failure is logged, not thrown, so it never fails the
 * surrounding save.
 */
export async function removeFile(path: string) {
  if (!path) return;
  try {
    await requireInbox().removeFile(path);
  } catch (e) {
    console.error('[inbox] removeFile failed:', path, e);
  }
  releaseBlobPath(path);
}

export function deleteItem(
  id: string,
  item?: InboxItem,
  options: { keepCalendarEntry?: boolean } = {},
): Promise<void> {
  // Queued so a save still landing can't follow the removal and resurrect
  // the item, and a later read-merge-write finds it gone.
  return runForItem(id, () => removeItem(id, item, options));
}

async function removeItem(
  id: string,
  snapshot: InboxItem | undefined,
  options: { keepCalendarEntry?: boolean },
) {
  const inbox = requireInbox();
  // Saves queued ahead of us may have moved the binaries; remove what is
  // stored now, not what the caller saw.
  const item = get(items)[id] ?? snapshot;
  await inbox.remove(id, item);
  // Dynamic: calendar-sync imports this module.
  if (item?.eventUrl) {
    const keep = options.keepCalendarEntry;
    void import('./calendar-sync').then((m) =>
      keep ? m.forgetEntry(item) : m.deleteSyncedEntry(item),
    );
  }

  // Revoke and remove any associated blob URLs (original + thumbnail) to
  // prevent memory leaks. All current callers pass the full item; we also do
  // a defensive lookup.
  const stored = get(items)[id] as
    | { filePath?: string; thumbPath?: string }
    | undefined;
  const asFileItem = item as
    | { filePath?: string; thumbPath?: string }
    | undefined;
  for (const path of [
    asFileItem?.filePath || stored?.filePath,
    asFileItem?.thumbPath || stored?.thumbPath,
  ]) {
    if (typeof path !== 'string' || !path) continue;
    releaseBlobPath(path);
  }

  rawItems.update((current) => {
    const next = { ...current };
    for (const key of Object.keys(next)) {
      if ((next[key] as { id?: string }).id === id) {
        delete next[key];
        break;
      }
    }
    return next;
  });
  items.update((current) => {
    const next = { ...current };
    for (const key of Object.keys(next)) {
      if (next[key].id === id) {
        delete next[key];
        break;
      }
    }
    return next;
  });
}

// ---- Collection operations ----

export async function storeCollection(collection: Collection) {
  const inbox = requireInbox();
  const clean = cleanForStorage(collection);
  await inbox.storeCollection(clean);
  collections.update((current) => ({ ...current, [clean.id]: clean }));
}

export async function setItemArchived(id: string, archived: boolean) {
  const item = get(items)[id];
  if (!item) return;
  await storeItem({
    ...item,
    archived: archived || undefined,
    archivedAt: archived ? new Date().toISOString() : undefined,
    archiveReason: archived ? 'manual' : undefined,
  });
}

export async function setCollectionArchived(id: string, archived: boolean) {
  const collection = get(collections)[id];
  if (!collection) return;
  await storeCollection({
    ...collection,
    archived: archived || undefined,
    archivedAt: archived ? new Date().toISOString() : undefined,
  });
}

/**
 * Delete a collection. Refuses if the collection still contains items — the
 * caller is expected to either move items out (drag/drop, picker) or delete
 * them first. This mirrors `deleteGroup`'s "must be empty" rule and avoids
 * silently unfiling user-filed items on a delete tap. Returns `true` on
 * success, `false` when the delete was refused.
 *
 * Items are matched by the live `collectionId` on each item rather than the
 * collection's `itemIds` array — that array can drift out of sync if a write
 * was interrupted, and the items themselves are the source of truth for
 * placement.
 */
export async function deleteCollection(id: string): Promise<boolean> {
  const inbox = requireInbox();
  const collection = get(collections)[id];
  if (!collection) return false;

  const allItems = get(items);
  const hasItems = Object.values(allItems).some((i) => i.collectionId === id);
  if (hasItems) {
    console.warn(
      '[inbox] cannot delete collection with items — remove them first',
    );
    return false;
  }

  const prevCollections = get(collections);
  try {
    await inbox.removeCollection(id);
    collections.update((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    await removeFromOrderConfig(id, 'collectionsOrder');
    return true;
  } catch (e) {
    collections.set(prevCollections);
    console.error('[inbox] deleteCollection failed, rolling back:', e);
    throw e;
  }
}

export async function moveItemToCollection(
  itemId: string,
  collectionId: string | undefined,
) {
  const inbox = requireInbox();

  // Validate target collection exists
  if (collectionId && !get(collections)[collectionId]) {
    console.error(
      '[inbox] moveItemToCollection: target collection does not exist:',
      collectionId,
    );
    // Creators store the item pre-filed and call this to register it in the
    // collection. If the collection vanished while the item write was in
    // flight (deleted by another client, say), the item now names a
    // collection no view lists — unfile it so it lands in Inbox/Unfiled
    // instead of disappearing.
    const stored = Object.values(get(items)).find((i) => i.id === itemId);
    if (stored?.collectionId === collectionId) {
      await moveItemToCollection(itemId, undefined);
    }
    return;
  }

  // Snapshot stores for rollback
  const prevItems = get(items);
  const prevCollections = get(collections);

  let oldCollectionId: string | undefined;

  try {
    // Read and write inside the item's queue, so a save still landing is
    // what we move, not an older snapshot.
    const item = await runForItem(itemId, async () => {
      let moved: InboxItem | undefined;
      items.update((current) => {
        const next = { ...current };
        for (const key of Object.keys(next)) {
          if (next[key].id === itemId) {
            oldCollectionId = next[key].collectionId;
            // Cast to a record so we can drop `collectionId` when the caller
            // moves the item back to Inbox/unfiled — the InboxItem union types
            // collectionId as required-but-optional and rejects structural
            // delete.
            const updated: Record<string, unknown> = { ...next[key] };
            if (collectionId) {
              updated.collectionId = collectionId;
            } else {
              delete updated.collectionId;
            }
            next[key] = updated as unknown as InboxItem;
            moved = updated as unknown as InboxItem;
            break;
          }
        }
        return next;
      });
      // Skip the item write when it already carries the target: creators
      // store the item pre-filed and call this only to register it in the
      // collection's itemIds. A second PUT to the same path right after the
      // first races remoteStorage.js's ETag bookkeeping — the server answers
      // 412 and the conflict resolves remote-wins, silently dropping the
      // filing (the todo reappears as Unfiled).
      if (moved && oldCollectionId !== collectionId) await writeItem(moved);
      return moved;
    });

    if (!item) return;

    const isSameCollection = oldCollectionId === collectionId;

    // Update source collection's itemIds
    if (oldCollectionId && !isSameCollection) {
      // Capture narrowed value so the closure below doesn't lose the type
      // narrowing (TS doesn't propagate narrowed values through closures).
      const colId = oldCollectionId;
      collections.update((current) => {
        const col = current[colId];
        if (col) {
          return {
            ...current,
            [colId]: {
              ...col,
              itemIds: col.itemIds.filter((id) => id !== itemId),
            },
          };
        }
        return current;
      });
      const sourceCol = get(collections)[oldCollectionId];
      if (sourceCol) {
        await inbox.storeCollection(cleanForStorage(sourceCol));
      }
    }

    // Update target collection's itemIds. A collection created with the
    // item already listed needs no second write (it would 412, see above).
    if (collectionId) {
      let added = false;
      collections.update((current) => {
        const col = current[collectionId];
        if (col && !col.itemIds.includes(itemId)) {
          added = true;
          return {
            ...current,
            [collectionId]: { ...col, itemIds: [...col.itemIds, itemId] },
          };
        }
        return current;
      });
      const targetCol = get(collections)[collectionId];
      if (targetCol && added) {
        await inbox.storeCollection(cleanForStorage(targetCol));
      }
    }
  } catch (e) {
    items.set(prevItems);
    collections.set(prevCollections);
    console.error('[inbox] moveItemToCollection failed, rolling back:', e);
    throw e;
  }
}

export async function removeItemFromCollection(itemId: string) {
  return moveItemToCollection(itemId, undefined);
}

export async function reorderCollectionItems(
  collectionId: string,
  newItemIds: string[],
) {
  const inbox = requireInbox();
  const prevCollections = get(collections);
  collections.update((current) => {
    const col = current[collectionId];
    if (col) {
      return { ...current, [collectionId]: { ...col, itemIds: newItemIds } };
    }
    return current;
  });
  try {
    const col = get(collections)[collectionId];
    if (col) {
      await inbox.storeCollection(cleanForStorage(col));
    }
  } catch (e) {
    collections.set(prevCollections);
    console.error('[inbox] reorderCollectionItems failed, rolling back:', e);
    throw e;
  }
}

/**
 * Expand/collapse helpers for the per-collection expansion state stored in
 * `appConfig.expandedCollections`. Callers pass the set of collection ids the
 * toggle should apply to (typically what's currently visible on the page).
 */
export async function setExpandedCollections(ids: string[]) {
  await updateConfig({ expandedCollections: ids });
}

// ---- Group operations ----

const allSortedGroups = orderedDerived<CollectionGroup>(groups, 'groupsOrder');

export const sortedGroups = derived(allSortedGroups, ($groups) =>
  $groups.filter((group) => !group.archived),
);

export const archivedGroups = derived(allSortedGroups, ($groups) =>
  $groups.filter((group) => group.archived),
);

export const archivedCollections = derived(
  [collections, groups],
  ([$collections, $groups]) =>
    Object.values($collections)
      .filter(
        (collection) =>
          collection.archived && !$groups[collection.groupId ?? '']?.archived,
      )
      .sort(
        (a, b) =>
          new Date(b.archivedAt ?? b.createdAt).getTime() -
          new Date(a.archivedAt ?? a.createdAt).getTime(),
      ),
);

export const groupCollections = derived(
  [collections, groups, appConfig],
  ([$collections, $groups]) => {
    const result: Record<string, Collection[]> = {};
    for (const [gid, group] of Object.entries($groups)) {
      const orderedIds = group.collectionIds.filter((cid) => {
        const col = $collections[cid];
        return col !== undefined && col.groupId === gid && !col.archived;
      });
      const orderedSet = new Set(orderedIds);
      // Start with ordered collections whose groupId matches
      const cols: Collection[] = orderedIds.map((cid) => $collections[cid]);
      // Append any collections whose groupId points here but missing from collectionIds
      for (const col of Object.values($collections)) {
        if (col.groupId === gid && !col.archived && !orderedSet.has(col.id)) {
          cols.push(col);
        }
      }
      result[gid] = cols;
    }
    return result;
  },
);

export async function storeGroup(group: CollectionGroup) {
  const inbox = requireInbox();
  const clean = cleanForStorage(group);
  const isNew = !get(groups)[clean.id];
  await inbox.storeGroup(clean);
  groups.update((current) => ({ ...current, [clean.id]: clean }));

  // New groups should appear active in the filter row so the user can see
  // them immediately. Only touch filters when they're explicitly set — an
  // undefined filter list means "all active" and already includes new groups.
  if (isNew) {
    const existing = get(appConfig).activeGroupFilters;
    if (existing !== undefined && !existing.includes(clean.id)) {
      await updateConfig({ activeGroupFilters: [...existing, clean.id] });
    }
  }
}

export async function setGroupArchived(id: string, archived: boolean) {
  const group = get(groups)[id];
  if (!group) return;
  await storeGroup({
    ...group,
    archived: archived || undefined,
    archivedAt: archived ? new Date().toISOString() : undefined,
  });
}

export async function deleteGroup(id: string): Promise<boolean> {
  const inbox = requireInbox();
  const currentGroups = get(groups);
  const group = currentGroups[id];

  if (!group) return false;

  // Refuse to delete a group that still has collections (check groupId, not stale collectionIds)
  const allCollections = get(collections);
  const hasCollections = Object.values(allCollections).some(
    (col) => col.groupId === id,
  );
  if (hasCollections) {
    console.warn(
      '[inbox] cannot delete group with collections — remove them first',
    );
    return false;
  }

  const prevGroups = get(groups);
  try {
    await inbox.removeGroup(id);
    groups.update((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    await removeFromOrderConfig(id, 'groupsOrder');
    // Drop the id from the filter allow-list too. Left behind it becomes a
    // stale id, and a list of nothing but stale ids is the state that makes
    // `activeGroupIds` report "all active" while the stored array says
    // otherwise — see the note on `toggleGroupFilter`. When pruning would empty
    // the list, reset to undefined ("all active") rather than [] ("show
    // nothing"): deleting a group is not a request to hide the survivors.
    const filters = get(appConfig).activeGroupFilters;
    if (filters?.includes(id)) {
      const next = filters.filter((f) => f !== id);
      await updateConfig({
        activeGroupFilters: next.length > 0 ? next : undefined,
      });
    }
    return true;
  } catch (e) {
    groups.set(prevGroups);
    console.error('[inbox] deleteGroup failed, rolling back:', e);
    throw e;
  }
}

export async function moveCollectionToGroup(
  collectionId: string,
  groupId: string,
) {
  const inbox = requireInbox();
  if (!groupId || !get(groups)[groupId]) {
    throw new Error(`Cannot move collection to missing group: ${groupId}`);
  }

  // Snapshot stores for rollback
  const prevCollections = get(collections);
  const prevGroups = get(groups);

  let col: Collection | undefined;
  let oldGroupId: string | undefined;

  collections.update((current) => {
    const next = { ...current };
    if (next[collectionId]) {
      oldGroupId = next[collectionId].groupId;
      const updated = { ...next[collectionId] };
      updated.groupId = groupId;
      next[collectionId] = updated as Collection;
      col = updated as Collection;
    }
    return next;
  });

  if (!col) return;

  try {
    // Skip the collection write when it already carries the target group
    // (createCollection stores it with its groupId and calls this only to
    // register it in the group). A second PUT right after the first can 412
    // and lose the write — see moveItemToCollection.
    if (oldGroupId !== groupId) {
      await inbox.storeCollection(cleanForStorage(col));
    }

    // Remove from old group (nothing to remove when it stays put — a second
    // write to the group right after the add below would race it, see above)
    if (oldGroupId && oldGroupId !== groupId) {
      // Capture narrowed value so the closure below keeps it non-undefined.
      const grpId = oldGroupId;
      groups.update((current) => {
        const grp = current[grpId];
        if (grp) {
          return {
            ...current,
            [grpId]: {
              ...grp,
              collectionIds: grp.collectionIds.filter(
                (id) => id !== collectionId,
              ),
            },
          };
        }
        return current;
      });
      const oldGrp = get(groups)[oldGroupId];
      if (oldGrp) {
        await inbox.storeGroup(cleanForStorage(oldGrp));
      }
    }

    // Add to new group. A group created with the collection already listed
    // needs no second write (it would 412, see above).
    let added = false;
    groups.update((current) => {
      const grp = current[groupId];
      if (grp && !grp.collectionIds.includes(collectionId)) {
        added = true;
        return {
          ...current,
          [groupId]: {
            ...grp,
            collectionIds: [...grp.collectionIds, collectionId],
          },
        };
      }
      return current;
    });
    const newGrp = get(groups)[groupId];
    if (newGrp && added) {
      await inbox.storeGroup(cleanForStorage(newGrp));
    }
  } catch (e) {
    collections.set(prevCollections);
    groups.set(prevGroups);
    console.error('[inbox] moveCollectionToGroup failed, rolling back:', e);
    throw e;
  }
}

/**
 * Create a collection in an explicit real group.
 */
export async function createCollection(col: Collection): Promise<Collection> {
  if (!col.groupId || !get(groups)[col.groupId]) {
    throw new Error('Cannot create collection without a real group');
  }
  await storeCollection(col);
  await moveCollectionToGroup(col.id, col.groupId);
  return col;
}

/**
 * Persist a new order for one group's collections.
 *
 * `newCollectionIds` is whatever the caller had on screen, which never
 * includes archived collections and — on the Collections page — excludes
 * anything the filter row has switched off. It's spliced into the stored
 * order rather than replacing it, so those keep their places.
 */
export async function reorderGroupCollections(
  groupId: string,
  newCollectionIds: string[],
) {
  const inbox = requireInbox();
  const prevGroups = get(groups);
  groups.update((current) => {
    const grp = current[groupId];
    if (grp) {
      return {
        ...current,
        [groupId]: {
          ...grp,
          collectionIds: spliceIntoOrder(
            grp.collectionIds ?? [],
            newCollectionIds,
          ),
        },
      };
    }
    return current;
  });
  try {
    const grp = get(groups)[groupId];
    if (grp) {
      await inbox.storeGroup(cleanForStorage(grp));
    }
  } catch (e) {
    groups.set(prevGroups);
    console.error('[inbox] reorderGroupCollections failed, rolling back:', e);
    throw e;
  }
}

/**
 * Persist a new order for the groups. `newOrder` omits archived groups (they
 * aren't in `sortedGroups`), so it's spliced into the stored order to keep
 * their positions for whenever they come back.
 */
export async function reorderGroups(newOrder: string[]) {
  const existing = get(appConfig).groupsOrder ?? [];
  await updateConfig({ groupsOrder: spliceIntoOrder(existing, newOrder) });
}

/**
 * Persist a new order for the unfiled-todo slice of `todosGlobalOrder`.
 *
 * This keeps a single source of truth — `todosGlobalOrder` — and splices the
 * new unfiled order back into their existing slots. Filed todos' positions in
 * the global order are preserved exactly; only
 * the ids that match the new set are replaced, in the order given.
 *
 * The caller passes the full new order of the unfiled subset (not a
 * delta). Ids not currently in `todosGlobalOrder` are appended at the end.
 */
export async function reorderUnfiledTodos(newUnfiledOrder: string[]) {
  const current = get(appConfig).todosGlobalOrder ?? [];
  const allItems = get(items);
  const isUnfiled = (id: string) => {
    const item = allItems[id];
    return (
      !!item && (item.isTodo || item.type === 'todo') && !item.collectionId
    );
  };
  const newSet = new Set(newUnfiledOrder);
  const queue = [...newUnfiledOrder];
  const result: string[] = [];
  for (const id of current) {
    if (isUnfiled(id) || newSet.has(id)) {
      // Pop the next id from `queue` that's actually in the new set — skip any
      // queue entries that dropped out (shouldn't happen in practice, but
      // keeps the splice resilient to stale callers).
      while (queue.length && !newSet.has(queue[0])) queue.shift();
      const next = queue.shift();
      if (next !== undefined) result.push(next);
    } else {
      result.push(id);
    }
  }
  // Append any ids the caller included that weren't already in the global
  // order (e.g. freshly-created todos whose id hasn't been persisted yet).
  while (queue.length) {
    const id = queue.shift();
    if (id === undefined) break;
    if (newSet.has(id) && !result.includes(id)) result.push(id);
  }
  await updateConfig({ todosGlobalOrder: result });
}

// ---- Group filter (toggle row) ----

/**
 * Set of group IDs currently active (visible) in the filter row.
 * When `activeGroupFilters` is undefined in config, all groups default to active.
 *
 * Stale-filter recovery: if `activeGroupFilters` is non-empty but every id in
 * it is stale (no matching real group), we fall back to "all active" instead
 * of returning an empty set. This is the offline-create-then-login recovery
 * path. Concrete sequence:
 *   1. The user has stale ids in `activeGroupFilters` from a previous session
 *      (e.g. a group they deleted long ago, whose id `setActiveGroupFilters`
 *      intentionally retains because the URL→config sync runs before groups
 *      load — see that function's note).
 *   2. While offline they create a new group `Zg`. `storeGroup` only appends
 *      to `activeGroupFilters` when it's already defined; if it was undefined
 *      ("default-all") locally, no append happens — so `Zg.id` may not be in
 *      filters.
 *   3. They log in. Sync pulls down the server's older `config/app` document
 *      (with just the stale ids, no `Zg`), which replaces the local copy.
 *   4. Without this fallback, `activeGroupIds` returns `∅`, and
 *      `visibleGroupedCollections` hides every group — the new `Zg` "remains"
 *      as a pill (pills render from `sortedGroups` directly) but nothing
 *      shows up on the page, making the offline-created collection appear
 *      "gone" even though it's intact in storage.
 *
 * An explicit empty array (`activeGroupFilters: []`, set by toggling every
 * pill off) keeps its meaning: "show nothing" — `length === 0` so the
 * fallback doesn't trigger.
 */
export const activeGroupIds = derived(
  [sortedGroups, appConfig],
  ([$sortedGroups, $config]) => {
    const all = new Set($sortedGroups.map((g) => g.id));
    if ($config.activeGroupFilters === undefined) return all;
    const filtered = new Set<string>();
    for (const id of $config.activeGroupFilters) {
      if (all.has(id)) filtered.add(id);
    }
    if (filtered.size === 0 && $config.activeGroupFilters.length > 0) {
      return all;
    }
    return filtered;
  },
);

/**
 * Collection IDs explicitly switched OFF in the sidebar layout (a deny-list).
 * A collection is hidden when its id is here, independent of its group's
 * active state. Stale ids (deleted collections) are harmless — views
 * intersect this against real collections at read time.
 */
export const inactiveCollectionIds = derived(
  appConfig,
  ($config) => new Set($config.inactiveCollectionFilters ?? []),
);

/**
 * Group + collection bundle, in the configured group order, filtered by
 * activeGroupIds. Within each group, collections preserve the configured
 * order from groupCollections, minus any individually switched off via the
 * sidebar (inactiveCollectionIds).
 *
 */
export interface VisibleGroupSection {
  group: CollectionGroup;
  collections: Collection[];
}

export const visibleGroupedCollections = derived(
  [sortedGroups, groupCollections, activeGroupIds, inactiveCollectionIds],
  ([
    $sortedGroups,
    $groupCollections,
    $activeGroupIds,
    $inactiveCollectionIds,
  ]): VisibleGroupSection[] => {
    const sections: VisibleGroupSection[] = [];
    for (const g of $sortedGroups) {
      if (!$activeGroupIds.has(g.id)) continue;
      const collections = ($groupCollections[g.id] ?? []).filter(
        (c) => !$inactiveCollectionIds.has(c.id),
      );
      sections.push({ group: g, collections });
    }
    return sections;
  },
);

/** The collection implied by the current filters when exactly one collection
 * is visible. Capture surfaces use this as their contextual filing default. */
export const soleVisibleCollectionId = derived(
  visibleGroupedCollections,
  ($sections): string | undefined => {
    let onlyId: string | undefined;
    for (const section of $sections) {
      for (const collection of section.collections) {
        if (onlyId !== undefined) return undefined;
        onlyId = collection.id;
      }
    }
    return onlyId;
  },
);

/**
 * Grouped collections the current filters keep out of view — their group is
 * switched off, or they are individually hidden. The inverse of
 * `visibleGroupedCollections`; capture surfaces use it to keep a hidden
 * destination from becoming a default, and the picker to section hidden
 * collections off from the ones in view.
 */
export const hiddenCollectionIds = derived(
  [sortedGroups, groupCollections, visibleGroupedCollections],
  ([$sortedGroups, $groupCollections, $sections]): Set<string> => {
    const visible = new Set<string>();
    for (const section of $sections) {
      for (const col of section.collections) visible.add(col.id);
    }
    const hidden = new Set<string>();
    for (const g of $sortedGroups) {
      for (const col of $groupCollections[g.id] ?? []) {
        if (!visible.has(col.id)) hidden.add(col.id);
      }
    }
    return hidden;
  },
);

/**
 * Todos the Todos page keeps showing even though the group filter would
 * drop them: a todo just filed, on purpose, into a hidden collection. The
 * user watched it land, so it stays put instead of vanishing. Cleared when
 * the filters change (the list is then rebuilt on the user's new terms) or
 * when the page is left.
 */
export const sessionVisibleTodoIds = writable<Set<string>>(new Set());

export function keepTodoVisible(id: string): void {
  sessionVisibleTodoIds.update((set) => {
    if (set.has(id)) return set;
    const next = new Set(set);
    next.add(id);
    return next;
  });
}

/**
 * Bumped every time the pins are cleared (filter change, Todos page
 * entered or left). A submit captures it before its first await and skips
 * its pin if it moved meanwhile: the list is already on new terms, and a
 * late pin must not leak into them.
 */
export const sessionPinGeneration = writable(0);

/**
 * The quick-add composer's destination override — a pick the shared
 * default can't express: a hidden or ungrouped collection (`string`), or
 * Unfiled while the view is narrowed (`null`). Lives here, not in the
 * composer, because the composer remounts between its hero and compact
 * layouts (first todo added) and the pick must survive that. Session-only,
 * and reset with the pins: the new filter is the user's newer, stronger
 * statement of where they are working.
 */
export const explicitTodoPick = writable<string | null | undefined>(undefined);

export function clearSessionVisibleTodos(): void {
  sessionPinGeneration.update((n) => n + 1);
  explicitTodoPick.set(undefined);
  if (get(sessionVisibleTodoIds).size === 0) return;
  sessionVisibleTodoIds.set(new Set());
}

/**
 * Content key of the *stored* todo filter settings (group allow-list +
 * collection deny-list). Changes only when a filter setting changes — not
 * when a group arrives by sync under the default "all groups" filter, and
 * not on unrelated store churn. Session-only state keyed on the filter —
 * the pins below, the composer's explicit pick — resets when this changes.
 */
export const todoFilterKey = derived(appConfig, ($config) =>
  JSON.stringify([
    // Order-insensitive; `undefined` (all groups) stays distinct from `[]`.
    $config.activeGroupFilters ? [...$config.activeGroupFilters].sort() : null,
    [...($config.inactiveCollectionFilters ?? [])].sort(),
  ]),
);

let lastFilterKey: string | undefined;
todoFilterKey.subscribe((key) => {
  if (lastFilterKey !== undefined && key !== lastFilterKey) {
    clearSessionVisibleTodos();
  }
  lastFilterKey = key;
});

/**
 * Collections whose `groupId` is unset or refers to a group that no longer
 * exists. Surfaced read-only on the Collections page as an advisory section
 * so users can edit each one back into a real group (or delete it). We do
 * NOT auto-rewrite these on load — see the v2.0.4 regression note in the
 * connect handler — and we do NOT create a synthetic group/collection for
 * them. The list is empty in the normal case; the UI only renders a section
 * when this is non-empty. Sorted by createdAt for a stable order.
 */
export const orphanCollections = derived(
  [collections, groups],
  ([$collections, $groups]): Collection[] => {
    return Object.values($collections)
      .filter((col) => !col.archived && (!col.groupId || !$groups[col.groupId]))
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
  },
);

/**
 * Toggle a group's filter on/off. Persists to config.
 * If activeGroupFilters was undefined (default-all), this materializes the
 * current set first, then flips the requested id.
 *
 * The "current" set is read from `activeGroupIds` — the same effective set the
 * pills and sidebar render from — not from the raw `activeGroupFilters` array.
 * Those two disagree whenever the stored array is non-empty but every id in it
 * is stale: `activeGroupIds` then falls back to all-active (see its note), so
 * every pill looks selected, while the raw array contains none of the real
 * ids. Reading the raw array there would score the click as an *activation*,
 * appending the id to a list of dead ones and leaving exactly one group
 * visible — "click any pill and it solos that group, with no way to switch one
 * off". Deriving from the effective set also prunes the stale ids on write, so
 * a single toggle heals the config.
 *
 * When *activating* a group, any per-collection hides (the deny-list) for that
 * group's collections are cleared, so "show this group" always reveals all of
 * its collections. This keeps the two sidebar gestures coherent: the group
 * toggle means "show everything in this group", while clicking an individual
 * collection (`enableCollectionFilter`) means "show just this one". Without
 * this, siblings hidden by an earlier exclusive collection-enable would stay
 * hidden even after re-enabling the group.
 */
export async function toggleGroupFilter(groupId: string): Promise<void> {
  const config = get(appConfig);
  const allGroupIds = get(sortedGroups).map((g) => g.id);
  const effective = get(activeGroupIds);
  const current = allGroupIds.filter((id) => effective.has(id));
  const activating = !current.includes(groupId);
  const next = activating
    ? [...current, groupId]
    : current.filter((id) => id !== groupId);

  const patch: Partial<AppConfig> = { activeGroupFilters: next };

  if (activating) {
    const deny = config.inactiveCollectionFilters;
    if (deny && deny.length > 0) {
      const groupColIds = new Set(
        (get(groupCollections)[groupId] ?? []).map((c) => c.id),
      );
      const nextDeny = deny.filter((id) => !groupColIds.has(id));
      if (nextDeny.length !== deny.length) {
        patch.inactiveCollectionFilters = nextDeny;
      }
    }
  }

  await updateConfig(patch);
}

/**
 * Show only `groupId`, hiding every other group — the ⌘/Ctrl-click gesture on a
 * group pill or sidebar row. Persists to config.
 *
 * The gesture is its own undo: soloing the group that is *already* alone
 * restores all groups (filters back to undefined, "default-all"). Without that,
 * getting back would mean clicking every other group on by hand — the exact
 * dead end plain toggling used to have.
 *
 * Like `toggleGroupFilter`, soloing clears any per-collection hides belonging to
 * the soloed group, so "show only this group" really does show all of it.
 * Restoring all groups leaves the deny-list alone: it undoes the solo, and is
 * not a "reveal everything" hammer.
 */
export async function soloGroupFilter(groupId: string): Promise<void> {
  const config = get(appConfig);
  const effective = get(activeGroupIds);

  if (effective.size === 1 && effective.has(groupId)) {
    await updateConfig({ activeGroupFilters: undefined });
    return;
  }

  const patch: Partial<AppConfig> = { activeGroupFilters: [groupId] };
  const deny = config.inactiveCollectionFilters;
  if (deny && deny.length > 0) {
    const groupColIds = new Set(
      (get(groupCollections)[groupId] ?? []).map((c) => c.id),
    );
    const nextDeny = deny.filter((id) => !groupColIds.has(id));
    if (nextDeny.length !== deny.length) {
      patch.inactiveCollectionFilters = nextDeny;
    }
  }

  await updateConfig(patch);
}

/** Set the active group filter list to exactly these IDs. Persists to config.
 *
 * Does not filter against known groups — the URL→config sync runs before
 * `groups` finishes loading on cold refresh, and dropping ids whose group
 * hasn't loaded yet would wipe valid filters and immediately rewrite the URL
 * to `?g=` empty. Stale ids (groups that were deleted) are filtered out at
 * read time by `activeGroupIds`, so persisting them is harmless.
 */
export async function setActiveGroupFilters(ids: string[]): Promise<void> {
  const filtered = Array.from(new Set(ids));
  const current = get(appConfig).activeGroupFilters;
  // Skip if equal to current (avoids URL ↔ config write loops)
  if (
    current &&
    current.length === filtered.length &&
    current.every((v, i) => v === filtered[i])
  ) {
    return;
  }
  await updateConfig({ activeGroupFilters: filtered });
}

/**
 * Toggle a single collection's visibility on/off (sidebar layout). Persists to
 * config as a deny-list entry — see `inactiveCollectionIds`. Independent of the
 * collection's group filter.
 */
export async function toggleCollectionFilter(
  collectionId: string,
): Promise<void> {
  const config = get(appConfig);
  const current = config.inactiveCollectionFilters ?? [];
  const activating = current.includes(collectionId);
  const next = activating
    ? current.filter((id) => id !== collectionId)
    : [...current, collectionId];
  await updateConfig({
    inactiveCollectionFilters: next,
    ...(activating && {
      expandedCollections: Array.from(
        new Set([...(config.expandedCollections ?? []), collectionId]),
      ),
    }),
  });
}

/**
 * Enable a single collection directly from the sidebar, making it visible even
 * when its parent group is currently switched off.
 *
 * - If the parent group was already active, this is a plain additive reveal:
 *   the collection is removed from the deny-list; siblings are untouched.
 * - If the parent group was NOT active, this is an *exclusive* enable: the
 *   group is activated and every other collection in it is deny-listed, so
 *   only the clicked collection shows. This spares the user from enabling the
 *   whole group and then hiding each sibling by hand — the point of the
 *   gesture. `toggleGroupFilter` clears these hides again on the next group
 *   activation, so "show the whole group" remains one click away.
 *
 * The selected collection is expanded so its contents are immediately visible.
 * A collection with no `groupId` (orphan) is also revealed and expanded.
 */
export async function enableCollectionFilter(
  collectionId: string,
): Promise<void> {
  const config = get(appConfig);
  const groupId = get(collections)[collectionId]?.groupId;
  const allGroupIds = get(sortedGroups).map((g) => g.id);
  const currentGroups = config.activeGroupFilters ?? allGroupIds;
  const groupActive = groupId ? currentGroups.includes(groupId) : true;

  const patch: Partial<AppConfig> = {};
  const deny = new Set(config.inactiveCollectionFilters ?? []);

  if (groupId && !groupActive) {
    // Activate the group and show only this collection.
    patch.activeGroupFilters = [...currentGroups, groupId];
    for (const col of get(groupCollections)[groupId] ?? []) {
      if (col.id !== collectionId) deny.add(col.id);
    }
  }
  // Always reveal the clicked collection (covers the group-already-active and
  // orphan cases, and guards against it being missing from the group list).
  deny.delete(collectionId);

  patch.inactiveCollectionFilters = Array.from(deny);
  patch.expandedCollections = Array.from(
    new Set([...(config.expandedCollections ?? []), collectionId]),
  );
  await updateConfig(patch);
}

/**
 * Show only one collection — the ⌘/Ctrl-click gesture on a sidebar
 * collection row. The collection's parent becomes the only active group and
 * every sibling collection is hidden.
 *
 * Repeating the gesture when the collection is already alone restores all
 * groups and all collections in its group. Deny-list entries belonging to
 * other groups are preserved.
 */
export async function soloCollectionFilter(
  collectionId: string,
): Promise<void> {
  const collection = get(collections)[collectionId];
  const groupId = collection?.groupId;
  if (!groupId) return;

  const siblings = (get(groupCollections)[groupId] ?? []).filter(
    (col) => col.id !== collectionId,
  );
  const effectiveGroups = get(activeGroupIds);
  const inactive = new Set(get(appConfig).inactiveCollectionFilters ?? []);
  const alreadySoloed =
    effectiveGroups.size === 1 &&
    effectiveGroups.has(groupId) &&
    !inactive.has(collectionId) &&
    siblings.every((col) => inactive.has(col.id));

  if (alreadySoloed) {
    for (const col of siblings) inactive.delete(col.id);
    await updateConfig({
      activeGroupFilters: undefined,
      inactiveCollectionFilters: Array.from(inactive),
    });
    return;
  }

  for (const col of siblings) inactive.add(col.id);
  inactive.delete(collectionId);
  await updateConfig({
    activeGroupFilters: [groupId],
    inactiveCollectionFilters: Array.from(inactive),
    expandedCollections: Array.from(
      new Set([...(get(appConfig).expandedCollections ?? []), collectionId]),
    ),
  });
}

// ---- Flat Todos page: all todos across all collections ----

/**
 * Every item that represents a todo. Todos without `collectionId` are unfiled
 * and remain valid todos; they are not routed through a collection/group.
 */
export const allTodos = derived(items, ($items) => {
  return Object.values($items).filter((i) => i.isTodo || i.type === 'todo');
});

/** Convenience: open todos across all collections, for badges/counts.
 *  Excludes todos moved to a calendar — the calendar owns those. */
export const openTodos = derived(allTodos, ($allTodos) =>
  $allTodos.filter((t) => !t.completed && !t.archived),
);

/**
 * The group-filter rule for the flat Todos page: unfiled todos are always
 * visible; filed todos require their collection's group to be active and
 * the collection not individually filtered out.
 */
function todoPassesGroupFilter(
  todo: InboxItem,
  $collections: Record<string, Collection>,
  $activeGroupIds: Set<string>,
  $inactiveCollectionIds: Set<string>,
): boolean {
  if (!todo.collectionId) return true;
  const col = $collections[todo.collectionId];
  if (!col) return true;
  if (col.archived) return false;
  if (!col.groupId) return false;
  if (!$activeGroupIds.has(col.groupId)) return false;
  return !$inactiveCollectionIds.has(col.id);
}

/**
 * Todos visible on the flat Todos page. Unfiled todos are always visible;
 * filed todos honour the group-filter row, except those the user just filed
 * into a hidden collection on purpose (`sessionVisibleTodoIds`). Sorted by
 * `todosGlobalOrder`; ids missing from that order fall back to newest-first
 * on `createdAt`. Completed
 * and open todos are mixed — the page splits them at render time.
 */
export const visibleTodos = derived(
  [
    allTodos,
    collections,
    activeGroupIds,
    inactiveCollectionIds,
    appConfig,
    todayStart,
    sessionVisibleTodoIds,
    groups,
  ],
  ([
    $allTodos,
    $collections,
    $activeGroupIds,
    $inactiveCollectionIds,
    $config,
    $todayStart,
    $kept,
    $groups,
  ]) => {
    // A pin bypasses the filter, not archiving: a kept todo whose
    // collection — or its whole group — gets archived mid-session leaves
    // like any other. (Archiving a group does not flag its collections.)
    const inArchivedCollection = (todo: InboxItem) => {
      if (!todo.collectionId) return false;
      const col = $collections[todo.collectionId];
      if (!col) return false;
      return (
        !!col.archived || !!(col.groupId && $groups[col.groupId]?.archived)
      );
    };
    // Lists keep their todos off the plan, except the one board column the
    // list brings back; those read as Someday when they have no plan.
    const listColumn = (todo: InboxItem): 'off' | 'someday' | 'on' => {
      const col = todo.collectionId
        ? $collections[todo.collectionId]
        : undefined;
      if (!col?.offPlan) return 'on';
      const set = col.planColumnId
        ? $config.columnSets?.find((x) => x.id === col.boardSetId)
        : undefined;
      return set && columnOf(todo, set) === col.planColumnId
        ? 'someday'
        : 'off';
    };
    const filtered = $allTodos.filter(
      (todo) =>
        !todo.archived &&
        listColumn(todo) !== 'off' &&
        (($kept.has(todo.id) && !inArchivedCollection(todo)) ||
          todoPassesGroupFilter(
            todo,
            $collections,
            $activeGroupIds,
            $inactiveCollectionIds,
          )),
    );

    const shown = filtered.map((todo) =>
      listColumn(todo) === 'someday' && !todo.planKind && !todo.startsAt
        ? ({ ...todo, planKind: 'someday' } as InboxItem)
        : todo,
    );

    const sorted = sortWithConfiguredOrder(
      shown,
      $config.todosGlobalOrder,
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    // Deadlines remain the strongest signal. Pinned items lead the manually
    // ordered band immediately below them.
    return pinDueTodos(pinItemsFirst(sorted), $todayStart);
  },
);

/**
 * Due/overdue todos float in a band above the manual order, earliest due
 * first; everything else keeps its configured position. Completed todos are
 * never band members (isDueTodayOrOverdue excludes them), so the page's
 * render-time open/completed split is unaffected.
 */
function pinDueTodos(sorted: InboxItem[], todayStartMs: number): InboxItem[] {
  const due = sorted
    .filter((t) => isDueTodayOrOverdue(t, todayStartMs))
    .sort(compareByDueTime);
  if (due.length === 0) return sorted;
  const rest = sorted.filter((t) => !isDueTodayOrOverdue(t, todayStartMs));
  return [...due, ...rest];
}

/**
 * Todos moved to a calendar, for the Todos page's collapsed "on calendar"
 * section. Honours the same group filter as `visibleTodos`; newest move
 * first. Removing the calendar entry returns a todo to the open list.
 */
export const visibleOnCalendarTodos = derived(
  [allTodos, collections, activeGroupIds, inactiveCollectionIds],
  ([$allTodos, $collections, $activeGroupIds, $inactiveCollectionIds]) =>
    $allTodos
      .filter(
        (todo) =>
          !!todo.archived &&
          todoPassesGroupFilter(
            todo,
            $collections,
            $activeGroupIds,
            $inactiveCollectionIds,
          ),
      )
      .sort(
        (a, b) =>
          new Date(b.archivedAt ?? b.createdAt).getTime() -
          new Date(a.archivedAt ?? a.createdAt).getTime(),
      ),
);

/**
 * Open todos within the current group/collection focus — exactly the set the
 * Todos page shows as "open". This is what the nav badge counts, so the badge
 * matches the list the user actually sees. Filtering to a group shrinks both
 * together, instead of the badge stubbornly reporting a global total.
 */
export const visibleOpenTodos = derived(visibleTodos, ($visibleTodos) =>
  $visibleTodos.filter((t) => !t.completed),
);

/**
 * Persist a new order for the open todos the flat Todos page had on screen.
 *
 * That list is a filtered view: the group filter hides other groups' todos,
 * and completed or on-calendar todos are not in the drag list. Replacing
 * `todosGlobalOrder` with it would drop everyone the user could not see, so
 * clearing the filter (or un-completing a todo) would find them dumped at
 * the end, in `createdAt` order. Splice the dragged order into the stored
 * one instead — the same rule as `reorderGroups`. Ids that show up later,
 * with no slot yet, still fall back to `createdAt` via
 * `sortWithConfiguredOrder` until a later reorder appends them.
 */
export async function reorderTodosGlobal(newOrder: string[]) {
  const existing = get(appConfig).todosGlobalOrder ?? [];
  await updateConfig({
    todosGlobalOrder: spliceIntoOrder(existing, newOrder),
  });
}
