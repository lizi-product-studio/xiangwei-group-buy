import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/utils/cart.ts', 'src/config/deployment.ts'],
      // 以当前关键购物车逻辑的实测基线作为门槛，后续只允许提高。
      thresholds: { lines: 65, functions: 40, branches: 55, statements: 50 },
    },
  },
});
