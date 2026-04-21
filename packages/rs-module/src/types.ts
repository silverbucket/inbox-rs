export type InboxItemType = 'bookmark' | 'note' | 'image' | 'audio' | 'video' | 'document' | 'todo' | 'email';

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
  collectionId?: string; // undefined = lives in Inbox (or Uncategorized, see `uncategorized`)
  /**
   * When true AND `collectionId` is unset, the item belongs to the
   * Uncategorized bucket on the Collections/Todos pages rather than the
   * Inbox. Typical sources:
   *   - user explicitly picks "Uncategorized" in the AddEntryModal picker
   *   - an item is orphaned when its parent collection is deleted
   *
   * Items without a `collectionId` and without this flag default to the Inbox
   * — they surface only in the Inbox view and never in the Uncategorized
   * bucket. Ignored when `collectionId` is set (a collection placement always
   * wins over Uncategorized).
   */
  uncategorized?: boolean;
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

export type InboxItem = BookmarkItem | NoteItem | ImageItem | AudioItem | VideoItem | DocumentItem | TodoItem | EmailItem;

export interface UserSettings {
  abbreviation?: string;
  theme?: 'system' | 'light' | 'dark';
}

export interface AppConfig {
  todosCollapsed?: boolean;
  collectionsOrder?: string[]; // ordered list of collection IDs for nav display
  groupsOrder?: string[];      // ordered list of group IDs for nav display
  todosOrder?: string[];       // ordered list of inbox todo IDs for manual sorting (within-inbox)
  expandedCollections?: string[]; // IDs of collections currently expanded
  /**
   * Group IDs that are toggled ON in the filter row.
   * When undefined: treat all groups as active (default for new users).
   * When set: only groups in this list are visible/filtered in.
   */
  activeGroupFilters?: string[];
  /**
   * Whether uncategorized todos (items without a collectionId) are visible on
   * the Todos page. Treated as a filter pill alongside group filters.
   * When undefined: defaults to true (visible).
   */
  uncategorizedFilterActive?: boolean;
  /**
   * Ordered list of todo IDs for the flat Todos page. Controls cross-collection
   * drag-sort order on that page only — collection-internal order (used by the
   * Collections page) still lives in `Collection.itemIds`.
   * Ids missing from this list fall back to their natural order (newest first).
   */
  todosGlobalOrder?: string[];
  /**
   * Whether the completed-todos section on the Todos page is expanded.
   * Defaults to false (collapsed behind "N completed").
   */
  completedTodosExpanded?: boolean;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  itemIds: string[];       // ordered array — controls sort order within collection
  createdAt: string;       // ISO 8601
  color?: string;          // optional accent color
  groupId?: string;        // optional group membership
}

export interface CollectionGroup {
  id: string;
  name: string;
  collectionIds: string[]; // ordered list of collection IDs in this group
  createdAt: string;       // ISO 8601
  color?: string;          // optional accent color
}
