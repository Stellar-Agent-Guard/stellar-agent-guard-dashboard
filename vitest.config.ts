import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    globals: true,
    // Add TypeScript path aliases if needed
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});