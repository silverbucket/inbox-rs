import { writable } from 'svelte/store';
import type { SectionId } from './settings-sections';

/**
 * Ask the app to open Settings at a section from anywhere (a board's
 * "Edit columns…", say). App watches this and clears it once handled.
 */
export const settingsRequest = writable<SectionId | null>(null);

/** The column set the Column sets section should show first. */
export const focusedColumnSetId = writable<string | null>(null);

export function openColumnSet(setId?: string) {
  focusedColumnSetId.set(setId ?? null);
  settingsRequest.set('columns');
}
