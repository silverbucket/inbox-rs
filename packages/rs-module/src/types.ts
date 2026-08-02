export type InboxItemType =
  | 'bookmark'
  | 'note'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'todo'
  | 'email';

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
  collectionId?: string; // undefined = Inbox for refs, unfiled for todos
  /**
   * Scheduling. The card is the editor — a calendar entry (once posted) is
   * a projection of these fields, never the other way around.
   * `startsAt` is the event start, or the due time when scheduleKind is
   * 'task'. ISO 8601. `endsAt` only applies to events. For all-day entries
   * both carry date-only semantics (time portion ignored).
   */
  startsAt?: string;
  endsAt?: string;
  allDay?: boolean;
  scheduleKind?: 'event' | 'task';
  /** CalDAV object href + etag once posted to a calendar; absent until then. */
  eventUrl?: string;
  eventEtag?: string;
  /**
   * Set when adding an Inbox reference card to a calendar: the calendar now
   * owns it, so it leaves the Inbox triage queue (collapsed "archived"
   * section). Never set on todos — they complete instead — and removing the
   * calendar entry clears it.
   */
  archived?: boolean;
  archivedAt?: string;
}

export interface BookmarkItem extends InboxItemBase {
  type: 'bookmark';
  url: string;
  favicon?: string;
  ogImage?: string;
  siteName?: string;
  body?: string; // embedded content (tweet text, article excerpt, etc.)
  filePath?: string; // locally stored image (downloaded og:image, tweet photo, etc.)
  mimeType?: string; // mime type for filePath
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
  /**
   * Optional downscaled preview stored alongside the original (grid cards
   * load this; the lightbox loads filePath). Absent on items captured by
   * clients that don't generate thumbnails — consumers must fall back to
   * filePath.
   */
  thumbPath?: string;
  thumbMimeType?: string;
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

export type InboxItem =
  | BookmarkItem
  | NoteItem
  | ImageItem
  | AudioItem
  | VideoItem
  | DocumentItem
  | TodoItem
  | EmailItem;

export interface UserSettings {
  abbreviation?: string;
  theme?: 'system' | 'light' | 'dark';
  /** Fetch link metadata (title/description/preview image) for bookmarks.
   *  Undefined means enabled. */
  linkPreviews?: boolean;
  /** Sockethub HTTP actions endpoint used for link-metadata fetching.
   *  Undefined/empty means the app's default server. */
  sockethubUrl?: string;
}

export interface AppConfig {
  todosCollapsed?: boolean;
  collectionsOrder?: string[]; // ordered list of collection IDs for nav display
  groupsOrder?: string[]; // ordered list of group IDs for nav display
  todosOrder?: string[]; // ordered list of inbox todo IDs for manual sorting (within-inbox)
  expandedCollections?: string[]; // IDs of collections currently expanded
  /**
   * Group IDs that are toggled ON in the filter row.
   * When undefined: treat all groups as active (default for new users).
   * When set: only groups in this list are visible/filtered in.
   */
  activeGroupFilters?: string[];
  /**
   * Collection IDs explicitly toggled OFF in the sidebar layout. A deny-list
   * (unlike activeGroupFilters' allow-list) so new collections default to
   * active without needing migration, and so a collection stays visible while
   * its group is active unless individually switched off.
   */
  inactiveCollectionFilters?: string[];
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
  /**
   * Best-effort hint for the group the user most recently saved a new
   * collection into. Callers must validate the referenced id still exists
   * before using it, because groups can be deleted between sessions.
   */
  lastSelectedGroupId?: string;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  itemIds: string[]; // ordered array — controls sort order within collection
  createdAt: string; // ISO 8601
  color?: string; // optional accent color
  groupId?: string; // optional group membership
}

export interface CollectionGroup {
  id: string;
  name: string;
  collectionIds: string[]; // ordered list of collection IDs in this group
  createdAt: string; // ISO 8601
  color?: string; // optional accent color
}
