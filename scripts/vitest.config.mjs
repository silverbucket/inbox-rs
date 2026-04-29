import { defineConfig } from 'vitest/config';

// Pure node — these scripts run during release/dev tooling, never in the
// browser. They have no Svelte/Vite dependencies, so a minimal config is
// enough.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['*.test.mjs'],
  },
});
