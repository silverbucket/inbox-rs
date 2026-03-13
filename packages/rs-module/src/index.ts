import { bookmarkSchema, noteSchema, imageMetaSchema, voiceMemoMetaSchema } from './schemas.js';
import type { InboxItem } from './types.js';

export type { InboxItem, InboxItemBase, InboxItemType, BookmarkItem, NoteItem, ImageItem, VoiceMemoItem } from './types.js';

export interface InboxModuleExports {
  getAll(): Promise<Record<string, InboxItem>>;
  getById(id: string): Promise<InboxItem | undefined>;
  store(item: InboxItem, fileData?: ArrayBuffer): Promise<void>;
  remove(id: string, item?: InboxItem): Promise<void>;
  getFile(path: string): Promise<{ data: ArrayBuffer; mimeType: string } | undefined>;
  onChange(handler: (event: unknown) => void): void;
}

const InboxModule = {
  name: 'inbox',
  builder: (privateClient: any) => {
    privateClient.declareType('bookmark', bookmarkSchema);
    privateClient.declareType('note', noteSchema);
    privateClient.declareType('image-meta', imageMetaSchema);
    privateClient.declareType('voice-memo-meta', voiceMemoMetaSchema);

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
            await privateClient.storeFile(item.mimeType, item.filePath, fileData);
          }
          const typeAlias = item.type === 'voice-memo' ? 'voice-memo-meta'
            : item.type === 'image' ? 'image-meta'
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
          return privateClient.getFile(path);
        },

        onChange(handler: (event: unknown) => void): void {
          privateClient.on('change', handler);
        }
      } satisfies InboxModuleExports
    };
  }
};

export default InboxModule;
