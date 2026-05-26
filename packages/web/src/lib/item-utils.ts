import type { InboxItem, InboxItemType } from '@inbox-rs/rs-module';
import { storeItem } from './stores';

/**
 * Raw inner SVG markup (paths, shapes) for each item type. Callers are expected
 * to wrap this in an `<svg>` element with their own sizing / stroke styles so
 * the same icon set works in a 12px pill badge and a 16px button.
 */
export const TYPE_ICON_PATHS: Record<InboxItemType, string> = {
  todo: '<polyline points="20 6 9 17 4 12"/>',
  bookmark:
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  audio:
    '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  video:
    '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
  document:
    '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  email:
    '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
};

export function typeIconPath(type: InboxItemType): string {
  return TYPE_ICON_PATHS[type] ?? '';
}

export async function makeTodo(item: InboxItem): Promise<void> {
  // Cast to a record so we can drop the now-stale `completedAt` field —
  // the discriminated InboxItem union doesn't allow structural deletes.
  const updated: Record<string, unknown> = {
    ...item,
    isTodo: true,
    completed: false,
  };
  delete updated.completedAt;
  await storeItem(updated as unknown as InboxItem);
}

export async function makeReference(item: InboxItem): Promise<void> {
  // Cast to a record for structural rewrites: dropping todo flags and
  // (when the source was a `todo` item) changing the `type` field.
  const updated: Record<string, unknown> = { ...item };
  delete updated.isTodo;
  delete updated.completed;
  delete updated.completedAt;
  if (updated.type === 'todo') {
    updated.type = 'note';
    if (!updated.body) updated.body = updated.description || '';
    delete updated.description;
  }
  await storeItem(updated as unknown as InboxItem);
}

export function typeBadge(item: InboxItem): string | null {
  return item.type === 'todo' ? null : item.type;
}

export function todoNote(item: InboxItem): string | null {
  // Reach into optional fields that don't exist on every variant of
  // InboxItem. A Record cast keeps the expression readable without
  // sprinkling `any` through the lookups.
  const r = item as Record<string, unknown>;
  const notes =
    ('notes' in item ? (r.notes as string | undefined) : null) ||
    item.description ||
    ('body' in item ? (r.body as string | undefined) : null);
  if (!notes) return null;
  const firstLine = notes.split('\n')[0].trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
}
