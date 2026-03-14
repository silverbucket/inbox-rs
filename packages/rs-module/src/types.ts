export type InboxItemType = 'bookmark' | 'note' | 'image' | 'voice-memo' | 'document' | 'code-snippet' | 'todo';

export interface InboxItemBase {
  id: string;
  type: InboxItemType;
  title: string;
  description?: string;
  createdAt: string; // ISO 8601
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
  body?: string;           // embedded content (tweet text, article excerpt, etc.)
  filePath?: string;       // locally stored image (downloaded og:image, tweet photo, etc.)
  mimeType?: string;       // mime type for filePath
}

export interface NoteItem extends InboxItemBase {
  type: 'note';
  body: string;
}

export interface ImageItem extends InboxItemBase {
  type: 'image';
  filePath: string;
  mimeType: string;
  sourceUrl?: string; // original URL the image was saved from
}

export interface VoiceMemoItem extends InboxItemBase {
  type: 'voice-memo';
  filePath: string;
  mimeType: string;
  duration?: number; // seconds
  body?: string; // transcription text
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

export type InboxItem = BookmarkItem | NoteItem | ImageItem | VoiceMemoItem | DocumentItem | CodeSnippetItem | TodoItem;
