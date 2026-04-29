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
  store(item: InboxItem, fileData?: ArrayBuffer): Promise<void>;
  remove(id: string, item?: InboxItem): Promise<void>;
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
          const item = await privateClient.getObject(`items/${id}`);
          if (
            item &&
            item._migrateVersion === undefined &&
            CURRENT_TYPES.has(item.type)
          ) {
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
          await privateClient.storeObject(
            schemaAlias(item.type),
            `items/${item.id}`,
            item,
          );
        },

        async remove(id: string, item?: InboxItem): Promise<void> {
          if (item && 'filePath' in item && item.filePath) {
            await privateClient.remove(item.filePath);
          }
          await privateClient.remove(`items/${id}`);
        },

        async getFile(
          path: string,
        ): Promise<{ data: ArrayBuffer; mimeType: string } | undefined> {
          const file = await privateClient.getFile(path);
          if (!file?.data) return undefined;
          const mimeType = file.mimeType || file.contentType;
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
          return (await privateClient.getObject('config/app')) || {};
        },

        async setConfig(config: AppConfig): Promise<void> {
          await privateClient.storeObject('app-config', 'config/app', config);
        },

        async getUserSettings(): Promise<UserSettings> {
          return (await privateClient.getObject('config/user')) || {};
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
          const cols = await privateClient.getAll('collections/', false);
          return cols || {};
        },

        async getCollectionById(id: string): Promise<Collection | undefined> {
          return privateClient.getObject(`collections/${id}`);
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
          const groups = await privateClient.getAll('groups/', false);
          return groups || {};
        },

        async getGroupById(id: string): Promise<CollectionGroup | undefined> {
          return privateClient.getObject(`groups/${id}`);
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
              privateClient.getAll('items/').then((r: any) => r || {}),
            save: async (key: string, doc: any) => {
              await privateClient.storeObject(
                schemaAlias(doc.type),
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
