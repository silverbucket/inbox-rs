import type { InboxItem, AppConfig } from './types.js';
export type { InboxItem, InboxItemBase, InboxItemType, BookmarkItem, NoteItem, ImageItem, VoiceMemoItem, DocumentItem, CodeSnippetItem, TodoItem, EmailItem, AppConfig } from './types.js';
export interface InboxModuleExports {
    getAll(): Promise<Record<string, InboxItem>>;
    getById(id: string): Promise<InboxItem | undefined>;
    store(item: InboxItem, fileData?: ArrayBuffer): Promise<void>;
    remove(id: string, item?: InboxItem): Promise<void>;
    getFile(path: string): Promise<{
        data: ArrayBuffer;
        mimeType: string;
    } | undefined>;
    getConfig(): Promise<AppConfig>;
    setConfig(config: AppConfig): Promise<void>;
    onChange(handler: (event: unknown) => void): void;
}
declare const InboxModule: {
    name: string;
    builder: (privateClient: any) => {
        exports: {
            getAll(): Promise<Record<string, InboxItem>>;
            getById(id: string): Promise<InboxItem | undefined>;
            store(item: InboxItem, fileData?: ArrayBuffer): Promise<void>;
            remove(id: string, item?: InboxItem): Promise<void>;
            getFile(path: string): Promise<{
                data: ArrayBuffer;
                mimeType: string;
            } | undefined>;
            getConfig(): Promise<AppConfig>;
            setConfig(config: AppConfig): Promise<void>;
            onChange(handler: (event: unknown) => void): void;
        };
    };
};
export default InboxModule;
