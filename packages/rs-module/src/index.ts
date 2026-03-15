import { bookmarkSchema, noteSchema, imageMetaSchema, voiceMemoMetaSchema, documentMetaSchema, codeSnippetSchema, todoSchema, appConfigSchema } from './schemas.js';
import type { InboxItem, AppConfig } from './types.js';

export type { InboxItem, InboxItemBase, InboxItemType, BookmarkItem, NoteItem, ImageItem, VoiceMemoItem, DocumentItem, CodeSnippetItem, TodoItem, AppConfig } from './types.js';

export interface InboxModuleExports {
  getAll(): Promise<Record<string, InboxItem>>;
  getById(id: string): Promise<InboxItem | undefined>;
  store(item: InboxItem, fileData?: ArrayBuffer): Promise<void>;
  remove(id: string, item?: InboxItem): Promise<void>;
  getFile(path: string): Promise<{ data: ArrayBuffer; mimeType: string } | undefined>;
  getConfig(): Promise<AppConfig>;
  setConfig(config: AppConfig): Promise<void>;
  onChange(handler: (event: unknown) => void): void;
}

const InboxModule = {
  name: 'inbox',
  builder: (privateClient: any) => {
    privateClient.declareType('bookmark', bookmarkSchema);
    privateClient.declareType('note', noteSchema);
    privateClient.declareType('image-meta', imageMetaSchema);
    privateClient.declareType('voice-memo-meta', voiceMemoMetaSchema);
    privateClient.declareType('document-meta', documentMetaSchema);
    privateClient.declareType('code-snippet', codeSnippetSchema);
    privateClient.declareType('todo', todoSchema);
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
          const typeAlias = item.type === 'voice-memo' ? 'voice-memo-meta'
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
        }
      } satisfies InboxModuleExports
    };
  }
};

export default InboxModule;
