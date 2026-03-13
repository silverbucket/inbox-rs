export type InboxItemType = 'bookmark' | 'note' | 'image' | 'voice-memo';

export interface InboxItemBase {
  id: string;
  type: InboxItemType;
  title: string;
  description?: string;
  createdAt: string; // ISO 8601
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
}

export type InboxItem = BookmarkItem | NoteItem | ImageItem | VoiceMemoItem;
