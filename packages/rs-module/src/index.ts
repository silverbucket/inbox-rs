import type { MigrateResult } from 'rs-migrate';
import {
  legacyBinaryStringToArrayBuffer,
  recoverLegacyBinaryStringEncoding,
} from './legacy/binary-recovery.js';
import { legacySchemas, migrator } from './migrations.js';
import {
  appConfigSchema,
  audioMetaSchema,
  bookmarkSchema,
  collectionGroupSchema,
  collectionSchema,
  documentMetaSchema,
  emailSchema,
  imageMetaSchema,
  noteSchema,
  todoSchema,
  userSettingsSchema,
  videoMetaSchema,
} from './schemas.js';
import type {
  AppConfig,
  Collection,
  CollectionGroup,
  InboxItem,
  InboxItemType,
  UserSettings,
} from './types.js';

export { recoverLegacyBinaryStringEncoding } from './legacy/binary-recovery.js';
export { migrator, wrapCodeBlock } from './migrations.js';
export type {
  BrowserStorageArea,
  ConfigStore,
  ConnectViaOAuthOptions,
  RSConfig,
  RSDiscovery,
} from './runtime.js';
export {
  connectViaOAuth,
  createConfigStore,
  DEFAULT_CONFIG_STORAGE_KEY,
  DirectRS,
  discoverStorage,
  extractTokenFromRedirect,
  parseUserAddress,
  schemeForHost,
} from './runtime.js';

/** Current item types — legacy types like 'voice-memo' are excluded */
const CURRENT_TYPES: Set<string> = new Set<string>([
  'bookmark',
  'note',
  'image',
  'audio',
  'video',
  'document',
  'todo',
  'email',
] satisfies InboxItemType[]);

export type {
  AppConfig,
  AudioItem,
  BookmarkItem,
  Collection,
  CollectionGroup,
  DocumentItem,
  EmailItem,
  ImageItem,
  InboxItem,
  InboxItemBase,
  InboxItemType,
  NoteItem,
  TodoItem,
  UserSettings,
  VideoItem,
} from './types.js';

export interface InboxModuleExports {
  getAll(): Promise<Record<string, InboxItem>>;
  getById(id: string): Promise<InboxItem | undefined>;
  store(
    item: InboxItem,
    fileData?: ArrayBuffer,
    thumbData?: ArrayBuffer,
  ): Promise<void>;
  remove(id: string, item?: InboxItem): Promise<void>;
  /** Delete a single stored file by path (e.g. an orphaned thumbnail). */
  removeFile(path: string): Promise<void>;
  getFile(
    path: string,
  ): Promise<{ data: ArrayBuffer; mimeType: string } | undefined>;
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
    case 'audio':
      return 'audio-meta';
    case 'image':
      return 'image-meta';
    case 'video':
      return 'video-meta';
    case 'document':
      return 'document-meta';
    default:
      return type;
  }
}

/**
 * Minimal shape of the remotestoragejs `BaseClient` we receive in the module
 * builder. Defined locally so we don't pull the whole `remotestoragejs` type
 * dependency tree into this module's public types — and because the library's
 * own typings declare most methods as returning `Promise<unknown>`, which we'd
 * have to cast through anyway.
 */
type RSPrivateClient = {
  declareType(name: string, schema: object): void;
  getAll(path: string, maxAge?: false | number): Promise<unknown>;
  getObject(path: string): Promise<unknown>;
  storeObject(type: string, path: string, obj: object): Promise<unknown>;
  storeFile(
    mimeType: string,
    path: string,
    data: ArrayBuffer,
  ): Promise<unknown>;
  getFile(path: string): Promise<unknown>;
  remove(path: string): Promise<unknown>;
  on(event: 'change', handler: (event: unknown) => void): void;
};

const InboxModule = {
  name: 'inbox',
  builder: (privateClient: RSPrivateClient) => {
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
          const items = (await privateClient.getAll('items/', false)) as
            | Record<string, InboxItem>
            | undefined;
          if (!items) return {};
          // Stamp _migrateVersion on items that lack it (e.g. written by
          // the mobile app's direct HTTP client) so they aren't falsely
          // flagged as needing migration by getPending().
          // Only stamp current types — legacy types (e.g. voice-memo) must
          // remain unstamped so their migrations still run.
          const latestVersion = migrator.getLatestVersion('items');
          for (const item of Object.values(items) as InboxItem[]) {
            if (
              item &&
              typeof item === 'object' &&
              item._migrateVersion === undefined &&
              CURRENT_TYPES.has(item.type)
            ) {
              item._migrateVersion = latestVersion;
            }
          }
          return items;
        },

        async getById(id: string): Promise<InboxItem | undefined> {
          const item = (await privateClient.getObject(`items/${id}`)) as
            | InboxItem
            | undefined;
          if (
            item &&
            item._migrateVersion === undefined &&
            CURRENT_TYPES.has(item.type)
          ) {
            item._migrateVersion = migrator.getLatestVersion('items');
          }
          return item;
        },

        async store(
          item: InboxItem,
          fileData?: ArrayBuffer,
          thumbData?: ArrayBuffer,
        ): Promise<void> {
          // Stamp new items with the current migration version so they aren't
          // flagged as needing migration by getPending().
          if (item._migrateVersion === undefined) {
            item._migrateVersion = migrator.getLatestVersion('items');
          }
          if (
            fileData &&
            'filePath' in item &&
            item.filePath &&
            'mimeType' in item &&
            item.mimeType
          ) {
            // Pass the original ArrayBuffer (not a binary string): the local
            // IndexedDB cache stores it exactly, and the sync layer pushes it
            // to the server intact on the next cycle.
            await privateClient.storeFile(
              item.mimeType,
              item.filePath,
              fileData,
            );
          }
          if (
            thumbData &&
            'thumbPath' in item &&
            item.thumbPath &&
            'thumbMimeType' in item &&
            item.thumbMimeType
          ) {
            await privateClient.storeFile(
              item.thumbMimeType,
              item.thumbPath,
              thumbData,
            );
          }
          await privateClient.storeObject(
            schemaAlias(item.type),
            `items/${item.id}`,
            item,
          );
        },

        async remove(id: string, item?: InboxItem): Promise<void> {
          // Metadata first, then the binary. If the second call fails
          // (network drop mid-operation), the failure mode is an orphaned,
          // invisible file — harmless and reclaimable. The previous order
          // (file first) could strand an item whose file was already gone:
          // a permanently broken card in every client.
          await privateClient.remove(`items/${id}`);
          if (item && 'filePath' in item && item.filePath) {
            await privateClient.remove(item.filePath);
          }
          if (item && 'thumbPath' in item && item.thumbPath) {
            await privateClient.remove(item.thumbPath);
          }
        },

        async removeFile(path: string): Promise<void> {
          await privateClient.remove(path);
        },

        async getFile(
          path: string,
        ): Promise<{ data: ArrayBuffer; mimeType: string } | undefined> {
          const file = (await privateClient.getFile(path)) as
            | {
                data: ArrayBuffer | string;
                mimeType?: string;
                contentType?: string;
              }
            | undefined;
          if (!file?.data) return undefined;
          const mimeType = file.mimeType || file.contentType || '';
          // Both branches are no-ops for correctly-uploaded files; they
          // recover bytes from the v1.8-and-earlier store path. See
          // `legacy/binary-recovery.ts` for the detection invariant.
          const data =
            typeof file.data === 'string'
              ? legacyBinaryStringToArrayBuffer(file.data)
              : recoverLegacyBinaryStringEncoding(file.data);
          return { data, mimeType };
        },

        async getConfig(): Promise<AppConfig> {
          return (
            ((await privateClient.getObject('config/app')) as AppConfig) || {}
          );
        },

        async setConfig(config: AppConfig): Promise<void> {
          await privateClient.storeObject('app-config', 'config/app', config);
        },

        async getUserSettings(): Promise<UserSettings> {
          return (
            ((await privateClient.getObject('config/user')) as UserSettings) ||
            {}
          );
        },

        async setUserSettings(settings: UserSettings): Promise<void> {
          await privateClient.storeObject(
            'user-settings',
            'config/user',
            settings,
          );
        },

        async getAllCollections(): Promise<Record<string, Collection>> {
          // See `getAll` above for why we pass `maxAge: false`.
          const cols = (await privateClient.getAll('collections/', false)) as
            | Record<string, Collection>
            | undefined;
          return cols || {};
        },

        async getCollectionById(id: string): Promise<Collection | undefined> {
          return (await privateClient.getObject(`collections/${id}`)) as
            | Collection
            | undefined;
        },

        async storeCollection(collection: Collection): Promise<void> {
          await privateClient.storeObject(
            'collection',
            `collections/${collection.id}`,
            collection,
          );
        },

        async removeCollection(id: string): Promise<void> {
          await privateClient.remove(`collections/${id}`);
        },

        async getAllGroups(): Promise<Record<string, CollectionGroup>> {
          // See `getAll` above for why we pass `maxAge: false`.
          const groups = (await privateClient.getAll('groups/', false)) as
            | Record<string, CollectionGroup>
            | undefined;
          return groups || {};
        },

        async getGroupById(id: string): Promise<CollectionGroup | undefined> {
          return (await privateClient.getObject(`groups/${id}`)) as
            | CollectionGroup
            | undefined;
        },

        async storeGroup(group: CollectionGroup): Promise<void> {
          await privateClient.storeObject(
            'collection-group',
            `groups/${group.id}`,
            group,
          );
        },

        async removeGroup(id: string): Promise<void> {
          await privateClient.remove(`groups/${id}`);
        },

        onChange(handler: (event: unknown) => void): void {
          privateClient.on('change', handler);
        },

        async runAllMigrations(): Promise<MigrateResult[]> {
          return migrator.migrateAll('items', {
            getAll: () =>
              privateClient
                .getAll('items/')
                .then((r) => (r ?? {}) as Record<string, unknown>),
            save: async (key: string, doc: Record<string, unknown>) => {
              await privateClient.storeObject(
                schemaAlias((doc.type as string) ?? ''),
                `items/${key}`,
                doc,
              );
            },
          });
        },
      } satisfies InboxModuleExports,
    };
  },
};

export default InboxModule;
