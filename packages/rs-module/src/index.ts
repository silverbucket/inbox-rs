import { bookmarkSchema, noteSchema, imageMetaSchema, audioMetaSchema, videoMetaSchema, documentMetaSchema, todoSchema, emailSchema, appConfigSchema, userSettingsSchema, collectionSchema, collectionGroupSchema } from './schemas.js';
import type { InboxItem, InboxItemType, AppConfig, UserSettings, Collection, CollectionGroup } from './types.js';
import type { MigrateResult } from 'rs-migrate';
import { migrator, legacySchemas } from './migrations.js';
export { migrator } from './migrations.js';
export { wrapCodeBlock } from './migrations.js';
export {
  DirectRS,
  connectViaOAuth,
  createConfigStore,
  discoverStorage,
  extractTokenFromRedirect,
  parseUserAddress,
  schemeForHost,
  DEFAULT_CONFIG_STORAGE_KEY,
} from './runtime.js';
export type {
  BrowserStorageArea,
  ConfigStore,
  ConnectViaOAuthOptions,
  RSConfig,
  RSDiscovery,
} from './runtime.js';

/** Current item types — legacy types like 'voice-memo' are excluded */
const CURRENT_TYPES: Set<string> = new Set<string>([
  'bookmark', 'note', 'image', 'audio', 'video',
  'document', 'todo', 'email',
] satisfies InboxItemType[]);

export type { InboxItem, InboxItemBase, InboxItemType, BookmarkItem, NoteItem, ImageItem, AudioItem, VideoItem, DocumentItem, TodoItem, EmailItem, AppConfig, UserSettings, Collection, CollectionGroup } from './types.js';

export interface InboxModuleExports {
  getAll(): Promise<Record<string, InboxItem>>;
  getById(id: string): Promise<InboxItem | undefined>;
  store(item: InboxItem, fileData?: ArrayBuffer): Promise<void>;
  remove(id: string, item?: InboxItem): Promise<void>;
  getFile(path: string): Promise<{ data: ArrayBuffer; mimeType: string } | undefined>;
  getConfig(): Promise<AppConfig>;
  setConfig(config: AppConfig): Promise<void>;
  getUserSettings(): Promise<UserSettings>;
  setUserSettings(settings: UserSettings): Promise<void>;
  getAllCollections(): Promise<Record<string, Collection>>;
  getCollectionById(id: string): Promise<Collection | undefined>;
  storeCollection(collection: Collection): Promise<void>;
  removeCollection(id: string): Promise<void>;
  getAllGroups(): Promise<Record<string, CollectionGroup>>;
  getGroupById(id: string): Promise<CollectionGroup | undefined>;
  storeGroup(group: CollectionGroup): Promise<void>;
  removeGroup(id: string): Promise<void>;
  onChange(handler: (event: unknown) => void): void;
  runAllMigrations(): Promise<MigrateResult[]>;
}

/** Maps item type to remoteStorage schema alias */
function schemaAlias(type: string): string {
  switch (type) {
    case 'audio': return 'audio-meta';
    case 'image': return 'image-meta';
    case 'video': return 'video-meta';
    case 'document': return 'document-meta';
    default: return type;
  }
}

/**
 * Recover the original bytes of a file that was uploaded by the legacy store
 * path (web app v1.8 and earlier).
 *
 * The legacy path converted the ArrayBuffer to a binary string with
 * `String.fromCharCode(byte)` per byte, then handed that string to
 * `storeFile`. The remotestoragejs sync layer then PUT the string body via
 * `fetch`, which UTF-8 encodes any code point > 0x7F — so a JPEG byte 0xFF
 * landed on the server as the two-byte sequence 0xC3 0xBF, doubling the size
 * of every high byte and making the file no longer a valid JPEG.
 *
 * The recovery is the exact inverse: UTF-8 decode the bytes back to the
 * binary string, then read each char's low byte to get the original byte.
 *
 * Detection is by structural test, not by per-format magic bytes:
 *
 *   - Real binary files (JPEG/PNG/etc.) almost always contain byte sequences
 *     that aren't valid UTF-8 (e.g. a lone 0xFF, which UTF-8 reserves as a
 *     never-valid lead byte). `TextDecoder({fatal:true})` throws on those,
 *     so we fall through and return the bytes unchanged.
 *   - Bytes that *do* decode as valid UTF-8 *and* whose every code point is
 *     < 256 can only have come from the binary-string-then-UTF-8 path —
 *     normal text with extended characters would produce code points >= 256
 *     for any non-Latin1 char, and arbitrary binary almost never round-trips
 *     through UTF-8 cleanly. So in practice this only fires on the legacy
 *     corruption pattern.
 *
 * Files that are already in the correct format pass through untouched
 * because of the throw on the first invalid byte. Returns the original
 * `ArrayBuffer` reference (not a copy) in that case.
 */
export function recoverLegacyBinaryStringEncoding(buffer: ArrayBuffer): ArrayBuffer {
  if (buffer.byteLength === 0) return buffer;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    for (let i = 0; i < decoded.length; i++) {
      // If any code point is >= 256, this isn't a binary-string round-trip
      // (the legacy encoder only ever produced chars 0–255). Bail out.
      if (decoded.charCodeAt(i) >= 256) return buffer;
    }
    const recovered = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      recovered[i] = decoded.charCodeAt(i);
    }
    return recovered.buffer;
  } catch {
    // Invalid UTF-8 → already raw binary. Return as-is.
    return buffer;
  }
}

const InboxModule = {
  name: 'inbox',
  builder: (privateClient: any) => {
    privateClient.declareType('bookmark', bookmarkSchema);
    privateClient.declareType('note', noteSchema);
    privateClient.declareType('image-meta', imageMetaSchema);
    privateClient.declareType('audio-meta', audioMetaSchema);
    privateClient.declareType('video-meta', videoMetaSchema);
    privateClient.declareType('document-meta', documentMetaSchema);

    // Register legacy schemas so old items can still be read for migration
    for (const ls of legacySchemas) {
      privateClient.declareType(ls.type, ls.schema);
    }
    privateClient.declareType('todo', todoSchema);
    privateClient.declareType('email', emailSchema);
    privateClient.declareType('app-config', appConfigSchema);
    privateClient.declareType('user-settings', userSettingsSchema);
    privateClient.declareType('collection', collectionSchema);
    privateClient.declareType('collection-group', collectionGroupSchema);

    return {
      exports: {
        async getAll(): Promise<Record<string, InboxItem>> {
          // Pass `maxAge: false` to skip the cache-freshness check.
          //
          // remotestoragejs's default is `2 * syncInterval` (≈20s when
          // connected), and with that default `getAll` queues a remote sync
          // GET when cached nodes are older than the threshold and only
          // resolves once that sync round-trip completes. On a cold refresh
          // this means landing on a page like /todos shows nothing for
          // several seconds while the GET drains, and any item operation
          // queued in the meantime appears to "block" until sync fires.
          //
          // We get fresh data through the `change` event subscription
          // (origin: 'remote') in stores.ts, so the snapshot can be cache-
          // first without losing remote updates — this just stops blocking
          // the UI on the first fetch.
          const items = await privateClient.getAll('items/', false);
          if (!items) return {};
          // Stamp _migrateVersion on items that lack it (e.g. written by
          // the mobile app's direct HTTP client) so they aren't falsely
          // flagged as needing migration by getPending().
          // Only stamp current types — legacy types (e.g. voice-memo) must
          // remain unstamped so their migrations still run.
          const latestVersion = migrator.getLatestVersion('items');
          for (const item of Object.values(items) as InboxItem[]) {
            if (item && typeof item === 'object'
                && item._migrateVersion === undefined
                && CURRENT_TYPES.has(item.type)) {
              item._migrateVersion = latestVersion;
            }
          }
          return items;
        },

        async getById(id: string): Promise<InboxItem | undefined> {
          const item = await privateClient.getObject(`items/${id}`);
          if (item && item._migrateVersion === undefined && CURRENT_TYPES.has(item.type)) {
            item._migrateVersion = migrator.getLatestVersion('items');
          }
          return item;
        },

        async store(item: InboxItem, fileData?: ArrayBuffer): Promise<void> {
          // Stamp new items with the current migration version so they aren't
          // flagged as needing migration by getPending().
          if (item._migrateVersion === undefined) {
            item._migrateVersion = migrator.getLatestVersion('items');
          }
          if (fileData && 'filePath' in item && item.filePath && 'mimeType' in item && item.mimeType) {
            // Store file locally as the original ArrayBuffer (not a binary
            // string). Two reasons this matters:
            //
            //   1. The local IndexedDB cache stays exact — `getFile` returns
            //      the same bytes we wrote, with no string/byte round-trip.
            //   2. `remotestoragejs`'s sync layer guards remote PUT with
            //      `needsRemotePut(node) { return typeof node.local.body === 'string' }`
            //      (see release/remotestorage.js). Passing an ArrayBuffer
            //      makes that check return false, so the sync **does not**
            //      try to push the body. That's what we want, because when
            //      the sync did push, it sent the binary-string body via
            //      `fetch(..., { body: string })` which UTF-8 encodes bytes
            //      > 127 and corrupts JPEGs (the file came back as zeros on
            //      5apps). Our direct `remote.put` below handles the upload
            //      with the original bytes; we just need sync to keep its
            //      hands off.
            await privateClient.storeFile(item.mimeType, item.filePath, fileData);

            // Push the file to the server ourselves, since the sync layer
            // intentionally skips ArrayBuffer bodies (see above).
            const remote = privateClient.storage.remote;
            if (remote?.connected) {
              const fullPath = '/inbox/' + item.filePath;
              try {
                // `remote.put` resolves with `{ statusCode }` for non-2xx
                // responses too (it only rejects on network errors), so
                // inspect the status explicitly — otherwise a 401/412/500
                // silently looks like success and the file is never uploaded.
                const resp = await remote.put(fullPath, fileData, item.mimeType);
                const status = resp?.statusCode;
                const success = typeof status === 'number' && status >= 200 && status < 300;
                if (success) {
                  console.log('[rs-module] direct PUT succeeded:', fullPath, status);
                } else {
                  console.warn('[rs-module] direct PUT returned non-success status:', fullPath, status);
                }
              } catch (e) {
                console.warn('[rs-module] direct PUT failed:', fullPath, e);
              }
            }
          }
          await privateClient.storeObject(schemaAlias(item.type), `items/${item.id}`, item);
        },

        async remove(id: string, item?: InboxItem): Promise<void> {
          if (item && 'filePath' in item && item.filePath) {
            await privateClient.remove(item.filePath);
          }
          await privateClient.remove(`items/${id}`);
        },

        async getFile(path: string): Promise<{ data: ArrayBuffer; mimeType: string } | undefined> {
          const file = await privateClient.getFile(path);
          if (!file?.data) return undefined;
          const mimeType = file.mimeType || file.contentType;
          // remotestoragejs may return a binary string when the file was
          // written by the legacy store path (`storeFile(mime, path,
          // binaryString)`). One charCodeAt per char gives back the original
          // bytes — that's the inverse of what the legacy encoder did.
          if (typeof file.data === 'string') {
            const bytes = new Uint8Array(file.data.length);
            for (let i = 0; i < file.data.length; i++) {
              bytes[i] = file.data.charCodeAt(i);
            }
            return { data: bytes.buffer, mimeType };
          }
          // ArrayBuffer path covers two cases:
          //   - new uploads (correct raw bytes — passes through untouched)
          //   - legacy uploads synced down from the server, where the sync
          //     layer's UTF-8 corruption baked into the bytes on disk
          // `recoverLegacyBinaryStringEncoding` handles the second case and
          // is a no-op for the first.
          return { data: recoverLegacyBinaryStringEncoding(file.data), mimeType };
        },

        async getConfig(): Promise<AppConfig> {
          return (await privateClient.getObject('config/app')) || {};
        },

        async setConfig(config: AppConfig): Promise<void> {
          await privateClient.storeObject('app-config', 'config/app', config);
        },

        async getUserSettings(): Promise<UserSettings> {
          return (await privateClient.getObject('config/user')) || {};
        },

        async setUserSettings(settings: UserSettings): Promise<void> {
          await privateClient.storeObject('user-settings', 'config/user', settings);
        },

        async getAllCollections(): Promise<Record<string, Collection>> {
          // See `getAll` above for why we pass `maxAge: false`.
          const cols = await privateClient.getAll('collections/', false);
          return cols || {};
        },

        async getCollectionById(id: string): Promise<Collection | undefined> {
          return privateClient.getObject(`collections/${id}`);
        },

        async storeCollection(collection: Collection): Promise<void> {
          await privateClient.storeObject('collection', `collections/${collection.id}`, collection);
        },

        async removeCollection(id: string): Promise<void> {
          await privateClient.remove(`collections/${id}`);
        },

        async getAllGroups(): Promise<Record<string, CollectionGroup>> {
          // See `getAll` above for why we pass `maxAge: false`.
          const groups = await privateClient.getAll('groups/', false);
          return groups || {};
        },

        async getGroupById(id: string): Promise<CollectionGroup | undefined> {
          return privateClient.getObject(`groups/${id}`);
        },

        async storeGroup(group: CollectionGroup): Promise<void> {
          await privateClient.storeObject('collection-group', `groups/${group.id}`, group);
        },

        async removeGroup(id: string): Promise<void> {
          await privateClient.remove(`groups/${id}`);
        },

        onChange(handler: (event: unknown) => void): void {
          privateClient.on('change', handler);
        },

        async runAllMigrations(): Promise<MigrateResult[]> {
          return migrator.migrateAll('items', {
            getAll: () => privateClient.getAll('items/').then((r: any) => r || {}),
            save: async (key: string, doc: any) => {
              await privateClient.storeObject(schemaAlias(doc.type), `items/${key}`, doc);
            },
          });
        }
      } satisfies InboxModuleExports
    };
  }
};

export default InboxModule;
