import type { Collection } from '@inbox-rs/rs-module';
import { writable } from 'svelte/store';

/**
 * Every collection, by id. Lives apart from stores.ts so small display
 * components (the calendar chip) can read it without pulling in, or
 * depending on mocks of, the whole storage layer. stores.ts re-exports it.
 */
export const collections = writable<Record<string, Collection>>({});
