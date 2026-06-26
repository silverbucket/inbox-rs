export const PRESET_COLORS = [
  // violet → pink → red → orange
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#ef4444',
  '#f97316',
  // yellow → green → teal → blue
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6474a8',
  // deeper / richer shades
  '#4f46e5',
  '#7c3aed',
  '#db2777',
  '#dc2626',
  '#ea580c',
  '#d97706',
  '#65a30d',
  '#15803d',
  // lighter / neutral
  '#0f766e',
  '#0284c7',
  '#2563eb',
  '#fca5a5',
  '#fbcfe8',
  '#bfdbfe',
  '#a1a1aa',
  '#6b7280',
];

/** Pick a random colour from the preset palette. Used as the default for newly
 *  created groups/collections so we don't always land on the first swatch when
 *  the user hasn't explicitly chosen one. */
export function randomPresetColor(): string {
  return PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
}
