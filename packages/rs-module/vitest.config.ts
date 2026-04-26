import { defineConfig } from 'vitest/config';

// rs-module is built with `tsc` for production; vitest runs the same .ts
// sources directly so tests don't depend on a prior build step.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
