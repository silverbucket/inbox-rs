export type InboxItemType = 'bookmark' | 'note' | 'image' | 'audio' | 'video' | 'document' | 'code-snippet' | 'todo' | 'email';

export interface InboxItemBase {
  id: string;
  type: InboxItemType;
  title: string;
  description?: string;
  createdAt: string; // ISO 8601
  _migrateVersion?: number; // rs-migrate: tracks which migrations have been applied
  isTodo?: boolean;
  completed?: boolean;
  completedAt?: string;
  collectionId?: string; // undefined = lives in inbox
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

export interface AudioItem extends InboxItemBase {
  type: 'audio';
  filePath: string;
  mimeType: string;
  duration?: number; // seconds
  body?: string; // transcription text
  transcribed?: boolean; // whether transcription has been handled
}

export interface VideoItem extends InboxItemBase {
  type: 'video';
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

export interface EmailItem extends InboxItemBase {
  type: 'email';
  body: string;
  from?: string;
  notes?: string;
  messageUrl?: string; // mid: URI to open in mail client
}

export type InboxItem = BookmarkItem | NoteItem | ImageItem | AudioItem | VideoItem | DocumentItem | CodeSnippetItem | TodoItem | EmailItem;

export interface UserSettings {
  abbreviation?: string;
  theme?: 'system' | 'light' | 'dark';
}

export interface AppConfig {
  todosCollapsed?: boolean;
  collectionsOrder?: string[]; // ordered list of collection IDs for nav display
  groupsOrder?: string[];      // ordered list of group IDs for nav display
  todosOrder?: string[];       // ordered list of inbox todo IDs for manual sorting
  expandedCollections?: string[]; // IDs of collections currently expanded
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  itemIds: string[];       // ordered array — controls sort order within collection
  createdAt: string;       // ISO 8601
  color?: string;          // optional accent color
  groupId?: string;        // optional group membership
  active?: boolean;        // when true, top todos surface in main todo list
}

export interface CollectionGroup {
  id: string;
  name: string;
  collectionIds: string[]; // ordered list of collection IDs in this group
  createdAt: string;       // ISO 8601
  color?: string;          // optional accent color
}
