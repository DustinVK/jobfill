import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // DOM-dependent suites opt in per file with `// @vitest-environment jsdom`.
    environment: 'node',
    globals: false,
    restoreMocks: true,
  },
});
