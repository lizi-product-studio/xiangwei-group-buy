import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/api.ts'],
      // 管理端刚建立首批回归测试，保留可执行的基线门槛并逐步提高。
      thresholds: { lines: 20, functions: 4, branches: 25, statements: 15 },
    },
  },
});
