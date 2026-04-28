import { defineConfig } from 'vitest/config';

// Thunderbird's source uses ambient `messenger` and `browser` types declared in
// src/types/thunderbird.d.ts. Tests don't need those globals at runtime — each
// suite stubs whatever it needs via vi.stubGlobal — so we just include the .ts
// source files directly without dragging the build system in.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
