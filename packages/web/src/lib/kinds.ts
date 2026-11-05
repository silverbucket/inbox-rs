/**
 * Each card type's name and identity colour, shared by the cards and the
 * Process inbox panel. Colours are fixed (independent of the theme accent)
 * so types stay distinguishable under any accent, light or dark.
 */
export const KIND: Record<string, { label: string; color: string }> = {
  note: { label: 'Note', color: '#c08a2e' },
  bookmark: { label: 'Bookmark', color: '#3b82f6' },
  image: { label: 'Image', color: '#3f9d6b' },
  audio: { label: 'Voice memo', color: '#7c6cf0' },
  document: { label: 'Document', color: '#c0573a' },
  email: { label: 'Email', color: '#2f8079' },
};

/** A type's name and colour, falling back to the raw type name. */
export function kindOf(type: string): { label: string; color: string } {
  return KIND[type] ?? { label: type, color: 'var(--text-muted)' };
}
