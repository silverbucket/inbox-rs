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
  if (item.type === 'bookmark' || 'body' in item) draft.body = item.body ?? '';
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

  if (item.type === 'bookmark') {
    record.body =
      draft.body === undefined ? item.body : draft.body || undefined;
  } else if ('body' in item) {
    record.body = draft.body ?? '';
  }
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

const MERGEABLE_DRAFT_KEYS = [
  'title',
  'description',
  'body',
  'url',
  'from',
  'notes',
  'completed',
] as const satisfies readonly (keyof CardDraft)[];

function draftField(
  draft: CardDraft,
  key: (typeof MERGEABLE_DRAFT_KEYS)[number],
): string | boolean | undefined {
  return draft[key];
}

/** True when two drafts carry the same editable field values. */
export function draftsEqual(a: CardDraft, b: CardDraft): boolean {
  return MERGEABLE_DRAFT_KEYS.every(
    (key) => draftField(a, key) === draftField(b, key),
  );
}

/**
 * Pull externally-updated fields into a local draft without clobbering
 * values the user has changed since the last persisted/synced snapshot.
 */
export function mergeExternalCardDraft(
  draft: CardDraft,
  synced: CardDraft,
  item: InboxItem,
): CardDraft | null {
  const external = createCardDraft(item);
  const merged = { ...draft };
  let changed = false;

  for (const key of MERGEABLE_DRAFT_KEYS) {
    if (draftField(draft, key) === draftField(synced, key)) {
      const next = draftField(external, key);
      if (draftField(draft, key) !== next) {
        (merged as Record<string, unknown>)[key] = next;
        changed = true;
      }
    }
  }

  return changed ? merged : null;
}
