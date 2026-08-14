import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/modules/{campaigns,orders,payments,fulfillment,notifications}/**/*.ts', 'src/app.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: {
        lines: 55,
        functions: 50,
        branches: 40,
        statements: 55,
      },
    },
  },
});
