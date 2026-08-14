import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/admin-web/e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: process.env.CI ? 'on' : 'retain-on-failure' },
  webServer: [
    {
      command: 'pnpm --filter @hometown/api dev',
      url: 'http://127.0.0.1:3100/health/ready',
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: { ...process.env, NODE_ENV: 'test', PORT: '3100', DATA_STORE: 'memory', QUEUE_DRIVER: 'memory', PAYMENT_PROVIDER: 'mock', COMMUNITY_FULFILLMENT_ENABLED: 'true', PLATFORM_PROCUREMENT_ENABLED: 'true', DEFAULT_BUSINESS_MODEL_VERSION: 'PLATFORM_COMMUNITY' },
    },
    {
      command: 'pnpm --filter @hometown/admin-web dev',
      url: 'http://127.0.0.1:5173',
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
