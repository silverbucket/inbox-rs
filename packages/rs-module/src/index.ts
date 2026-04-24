import { bookmarkSchema, noteSchema, imageMetaSchema, audioMetaSchema, videoMetaSchema, documentMetaSchema, todoSchema, emailSchema, appConfigSchema, userSettingsSchema, collectionSchema, collectionGroupSchema } from './schemas.js';
import type { InboxItem, InboxItemType, AppConfig, UserSettings, Collection, CollectionGroup } from './types.js';
import type { MigrateResult } from 'rs-migrate';
import { migrator, legacySchemas } from './migrations.js';
export { migrator } from './migrations.js';
export { wrapCodeBlock } from './migrations.js';

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
          const items = await privateClient.getAll('items/');
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
            // Store file locally for immediate access
            const bytes = new Uint8Array(fileData);
            let binaryString = '';
            for (let i = 0; i < bytes.length; i++) {
              binaryString += String.fromCharCode(bytes[i]);
            }
            await privateClient.storeFile(item.mimeType, item.filePath, binaryString);

            // Also PUT directly to remote — remotestoragejs sync has a bug
            // where it silently fails to push binary file bodies to the server.
            const remote = privateClient.storage.remote;
            if (remote?.connected) {
              const fullPath = '/inbox/' + item.filePath;
              try {
                // Send the original ArrayBuffer, not the binary string —
                // fetch encodes strings as UTF-8, corrupting bytes > 127.
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
          // remotestoragejs may return a binary string; convert to ArrayBuffer
          if (typeof file.data === 'string') {
            const bytes = new Uint8Array(file.data.length);
            for (let i = 0; i < file.data.length; i++) {
              bytes[i] = file.data.charCodeAt(i);
            }
            return { data: bytes.buffer, mimeType: file.mimeType || file.contentType };
          }
          return { data: file.data, mimeType: file.mimeType || file.contentType };
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
          const cols = await privateClient.getAll('collections/');
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
          const groups = await privateClient.getAll('groups/');
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
