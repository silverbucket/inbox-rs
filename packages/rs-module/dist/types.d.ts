export type InboxItemType = 'bookmark' | 'note' | 'image' | 'audio' | 'document' | 'code-snippet' | 'todo' | 'email';
export interface InboxItemBase {
    id: string;
    type: InboxItemType;
    title: string;
    description?: string;
    createdAt: string;
    isTodo?: boolean;
    completed?: boolean;
    completedAt?: string;
}
export interface BookmarkItem extends InboxItemBase {
    type: 'bookmark';
    url: string;
    favicon?: string;
    ogImage?: string;
    siteName?: string;
    body?: string;
    filePath?: string;
    mimeType?: string;
}
export interface NoteItem extends InboxItemBase {
    type: 'note';
    body: string;
}
export interface ImageItem extends InboxItemBase {
    type: 'image';
    filePath: string;
    mimeType: string;
    sourceUrl?: string;
}
export interface AudioItem extends InboxItemBase {
    type: 'audio';
    filePath: string;
    mimeType: string;
    duration?: number;
    body?: string;
}
export interface DocumentItem extends InboxItemBase {
    type: 'document';
    filePath: string;
    mimeType: string;
    fileSize?: number;
    fileName?: string;
}
export interface CodeSnippetItem extends InboxItemBase {
    type: 'code-snippet';
    body: string;
    language?: string;
}
export interface TodoItem extends InboxItemBase {
    type: 'todo';
    body?: string;
    completed: boolean;
    completedAt?: string;
}
export interface EmailItem extends InboxItemBase {
    type: 'email';
    body: string;
    from?: string;
    notes?: string;
    messageUrl?: string;
}
export type InboxItem = BookmarkItem | NoteItem | ImageItem | AudioItem | DocumentItem | CodeSnippetItem | TodoItem | EmailItem;
export interface AppConfig {
    todosCollapsed?: boolean;
}
