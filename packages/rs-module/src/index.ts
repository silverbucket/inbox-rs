import { bookmarkSchema, noteSchema, imageMetaSchema, audioMetaSchema, documentMetaSchema, codeSnippetSchema, todoSchema, emailSchema, appConfigSchema } from './schemas.js';
import type { InboxItem, AppConfig } from './types.js';
import { migrations } from './migrations.js';
export type { Migration } from './migrations.js';

export type { InboxItem, InboxItemBase, InboxItemType, BookmarkItem, NoteItem, ImageItem, AudioItem, DocumentItem, CodeSnippetItem, TodoItem, EmailItem, AppConfig } from './types.js';

export interface MigrationResult {
  migrationId: string;
  migratedCount: number;
}

export interface PendingMigration {
  id: string;
  description: string;
  itemCount: number;
}

export interface InboxModuleExports {
  getAll(): Promise<Record<string, InboxItem>>;
  getById(id: string): Promise<InboxItem | undefined>;
  store(item: InboxItem, fileData?: ArrayBuffer): Promise<void>;
  remove(id: string, item?: InboxItem): Promise<void>;
  getFile(path: string): Promise<{ data: ArrayBuffer; mimeType: string } | undefined>;
  getConfig(): Promise<AppConfig>;
  setConfig(config: AppConfig): Promise<void>;
  onChange(handler: (event: unknown) => void): void;
  getPendingMigrations(): Promise<PendingMigration[]>;
  runMigration(migrationId: string): Promise<MigrationResult>;
}

const InboxModule = {
  name: 'inbox',
  builder: (privateClient: any) => {
    privateClient.declareType('bookmark', bookmarkSchema);
    privateClient.declareType('note', noteSchema);
    privateClient.declareType('image-meta', imageMetaSchema);
    privateClient.declareType('audio-meta', audioMetaSchema);
    privateClient.declareType('document-meta', documentMetaSchema);

    // Register legacy schemas so old items can still be read for migration
    for (const m of migrations) {
      if (m.oldSchema) {
        privateClient.declareType(m.oldType, m.oldSchema);
      }
    }
    privateClient.declareType('code-snippet', codeSnippetSchema);
    privateClient.declareType('todo', todoSchema);
    privateClient.declareType('email', emailSchema);
    privateClient.declareType('app-config', appConfigSchema);

    return {
      exports: {
        async getAll(): Promise<Record<string, InboxItem>> {
          const items = await privateClient.getAll('items/');
          return items || {};
        },

        async getById(id: string): Promise<InboxItem | undefined> {
          return privateClient.getObject(`items/${id}`);
        },

        async store(item: InboxItem, fileData?: ArrayBuffer): Promise<void> {
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
                // fetch encodes strings as UTF-8, corrupting bytes > 127
                await remote.put(fullPath, fileData, item.mimeType);
                console.log('[rs-module] direct PUT succeeded:', fullPath);
              } catch (e) {
                console.warn('[rs-module] direct PUT failed:', fullPath, e);
              }
            }
          }
          const typeAlias = item.type === 'audio' ? 'audio-meta'
            : item.type === 'image' ? 'image-meta'
            : item.type === 'document' ? 'document-meta'
            : item.type;
          await privateClient.storeObject(typeAlias, `items/${item.id}`, item);
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

        onChange(handler: (event: unknown) => void): void {
          privateClient.on('change', handler);
        },

        async getPendingMigrations(): Promise<PendingMigration[]> {
          const pending: PendingMigration[] = [];
          const allItems = await privateClient.getAll('items/');
          if (!allItems) return pending;

          for (const m of migrations) {
            let count = 0;
            for (const item of Object.values(allItems)) {
              if (item && typeof item === 'object' && 'type' in item && (item as any).type === m.oldItemType) {
                count++;
              }
            }
            if (count > 0) {
              pending.push({ id: m.id, description: m.description, itemCount: count });
            }
          }
          return pending;
        },

        async runMigration(migrationId: string): Promise<MigrationResult> {
          const m = migrations.find(m => m.id === migrationId);
          if (!m) throw new Error(`Unknown migration: ${migrationId}`);

          const allItems = await privateClient.getAll('items/');
          let migratedCount = 0;
          if (allItems) {
            for (const [key, item] of Object.entries(allItems)) {
              if (item && typeof item === 'object' && 'type' in item && (item as any).type === m.oldItemType) {
                const transformed = m.transform(item);
                const typeAlias = transformed.type === 'audio' ? 'audio-meta'
                  : transformed.type === 'image' ? 'image-meta'
                  : transformed.type === 'document' ? 'document-meta'
                  : transformed.type;
                await privateClient.storeObject(typeAlias, `items/${key}`, transformed);
                migratedCount++;
              }
            }
          }
          return { migrationId, migratedCount };
        }
      } satisfies InboxModuleExports
    };
  }
};

export default InboxModule;
