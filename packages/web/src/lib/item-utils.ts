import type { InboxItem } from '@inbox-rs/rs-module';
import { storeItem } from './stores';

export async function makeTodo(item: InboxItem): Promise<void> {
  const updated = { ...item, isTodo: true, completed: false };
  delete (updated as any).completedAt;
  await storeItem(updated as InboxItem);
}

export async function makeReference(item: InboxItem): Promise<void> {
  const updated = { ...item };
  delete (updated as any).isTodo;
  delete (updated as any).completed;
  delete (updated as any).completedAt;
  if (updated.type === 'todo') {
    (updated as any).type = 'note';
    if (!(updated as any).body) (updated as any).body = '';
  }
  await storeItem(updated as InboxItem);
}

export function typeBadge(item: InboxItem): string | null {
  return item.type === 'todo' ? null : item.type;
}

export function todoNote(item: InboxItem): string | null {
  const notes = ('notes' in item ? (item as any).notes : null) || item.description || ('body' in item ? (item as any).body : null);
  if (!notes) return null;
  const firstLine = notes.split('\n')[0].trim();
  return firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine;
}
