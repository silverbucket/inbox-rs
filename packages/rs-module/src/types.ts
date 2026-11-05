export type InboxItemType =
  | 'bookmark'
  | 'note'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'todo'
  | 'email';

/** Soft-plan horizon kinds. See `InboxItemBase.planKind`. */
export type PlanKind = 'next' | 'week' | 'month' | 'someday';

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
  /** Keeps an active todo or reference at the top of its list. */
  pinned?: boolean;
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
  /** Where it happens: venue, address or meeting link. */
  location?: string;
  /**
   * Soft plan — "roughly when", with no deadline. Only meaningful on open
   * todos, and only while `startsAt` is unset (a real date always wins).
   * `planKind` picks the horizon; `planStart` (YYYY-MM-DD, local) anchors
   * week and month plans to the Monday / first day of the planned period.
   * Periods are never rewritten as time passes: a plan whose period has
   * ended reads as "rolled over" into Up next, computed at render time.
   */
  planKind?: PlanKind;
  planStart?: string;
  /**
   * Board placement: column set id → column id. Keyed by set so an item
   * keeps its column in every set it has been on; moving a collection back
   * to an earlier set restores where its items were. A missing or unknown
   * column reads as the set's Unsorted column.
   */
  boardColumns?: Record<string, string>;
  /** CalDAV object href + etag once posted to a calendar; absent until then. */
  eventUrl?: string;
  eventEtag?: string;
  /**
   * Set when posting an item to a calendar in "move" mode: the calendar now
   * owns it, so it leaves the active lists for its surface's collapsed
   * "on calendar" section (Inbox archived section for unfiled cards, the
   * Todos page's section for todos, the collection view's for filed items).
   * "Copy" mode never sets it. Re-enabling clears it locally — the calendar
   * entry is never deleted on the user's behalf.
   */
  archived?: boolean;
  archivedAt?: string;
  /** Why the card was archived. Missing on legacy calendar-moved cards. */
  archiveReason?: 'manual' | 'calendar';
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
  filePath?: string; // absent when a source host blocks local capture
  mimeType?: string;
  sourceUrl?: string; // original URL the image was saved from
  body?: string; // markdown notes retained when converting a bookmark
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
  /** Whether posting an item to a calendar moves it (archives it in the
   *  app) or keeps an active copy. Undefined means 'move'. */
  calendarPostMode?: 'move' | 'copy';
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
  /**
   * Favourite collections, in the user's order. Shown first in the sidebar
   * and in every collection picker. Ids that no longer exist are ignored.
   */
  favoriteCollectionIds?: string[];
  /**
   * Todos-page plan sections the user has folded (or unfolded). Undefined
   * means the defaults: later horizons folded, near ones open.
   */
  collapsedPlanSections?: string[];
  /**
   * How the Todos page lays out the plan. Undefined means the default:
   * 'today' on narrow screens, 'horizon' otherwise.
   */
  todosView?: 'today' | 'horizon' | 'board' | 'calendar';
  /**
   * Shared board columns, in the user's order. A collection opts in with
   * `Collection.boardSetId`; collections on the same set can share a board.
   */
  columnSets?: ColumnSet[];
  /** How each collection is shown: collection id → view. Default: grid. */
  collectionViews?: Record<string, CollectionViewMode>;
}

export type CollectionViewMode = 'grid' | 'list' | 'board';

/** Id of every set's first column, where new and unplaced items land. */
export const BOARD_UNSORTED = 'unsorted';

export interface BoardColumn {
  id: string;
  name: string;
  color: string;
  /** Checking a todo on the board moves it here instead of hiding it. */
  done?: boolean;
}

export interface ColumnSet {
  id: string;
  name: string;
  /** First is always Unsorted (id `BOARD_UNSORTED`), which can't be deleted. */
  columns: BoardColumn[];
  createdAt: string;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  itemIds: string[]; // ordered array — controls sort order within collection
  createdAt: string; // ISO 8601
  color?: string; // optional accent color
  groupId?: string; // optional group membership
  archived?: boolean;
  archivedAt?: string;
  /** Column set this collection's board uses; unset means no board. */
  boardSetId?: string;
  /**
   * A list (Movies, a reading list): its todos stay off the Todos plan.
   * `planColumnId` brings one board column's todos back as Someday.
   */
  offPlan?: boolean;
  planColumnId?: string;
}

export interface CollectionGroup {
  id: string;
  name: string;
  collectionIds: string[]; // ordered list of collection IDs in this group
  createdAt: string; // ISO 8601
  color?: string; // optional accent color
  archived?: boolean;
  archivedAt?: string;
}
