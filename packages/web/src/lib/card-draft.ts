import type { InboxItem, InboxItemType } from '@inbox-rs/rs-module';

export const CARD_DRAFT_PREFIX = 'inbox-rs:card-draft:';

export interface CardDraft {
  id: string;
  type: InboxItemType;
  title: string;
  description: string;
  body?: string;
  url?: string;
  from?: string;
  notes?: string;
  completed?: boolean;
}

export function createCardDraft(item: InboxItem): CardDraft {
  const draft: CardDraft = {
    id: item.id,
    type: item.type,
    title: item.title,
    description: item.description ?? '',
  };
  if ('body' in item) draft.body = item.body ?? '';
  if (item.type === 'bookmark') draft.url = item.url;
  if (item.type === 'email') {
    draft.from = item.from ?? '';
    draft.notes = item.notes ?? '';
  }
  if (item.isTodo || item.type === 'todo') {
    draft.completed = !!item.completed;
  }
  return draft;
}

export function applyCardDraft(
  item: InboxItem,
  draft: CardDraft,
  now: Date = new Date(),
): InboxItem {
  const updated = {
    ...item,
    title: draft.title,
    description: draft.description || undefined,
  } as InboxItem;
  const record = updated as unknown as Record<string, unknown>;

  if ('body' in item) record.body = draft.body ?? '';
  if (item.type === 'bookmark') record.url = draft.url ?? '';
  if (item.type === 'email') {
    record.from = draft.from || undefined;
    record.notes = draft.notes || undefined;
  }
  if (item.isTodo || item.type === 'todo') {
    const completed = !!draft.completed;
    record.completed = completed;
    record.isTodo = true;
    if (completed && !item.completed) {
      record.completedAt = now.toISOString();
    }
  }
  return updated;
}

export function cardDraftKey(id: string): string {
  return `${CARD_DRAFT_PREFIX}${id}`;
}

export function readCardDraft(
  item: InboxItem,
  storage: Pick<Storage, 'getItem'>,
): CardDraft | null {
  try {
    const raw = storage.getItem(cardDraftKey(item.id));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<CardDraft>;
    if (
      draft.id !== item.id ||
      draft.type !== item.type ||
      typeof draft.title !== 'string' ||
      typeof draft.description !== 'string'
    ) {
      return null;
    }
    return draft as CardDraft;
  } catch {
    return null;
  }
}

export function writeCardDraft(
  draft: CardDraft,
  storage: Pick<Storage, 'setItem'>,
): void {
  try {
    storage.setItem(cardDraftKey(draft.id), JSON.stringify(draft));
  } catch {
    // Storage can be disabled or full. Autosave still proceeds normally.
  }
}

export function clearCardDraft(
  id: string,
  storage: Pick<Storage, 'removeItem'>,
): void {
  try {
    storage.removeItem(cardDraftKey(id));
  } catch {
    // Non-fatal: a successfully persisted card remains the source of truth.
  }
}
