import { defineConfig } from '@playwright/test';

const apiPort = process.env.E2E_API_PORT ?? '3101';
const apiUrl = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  testDir: './apps/admin-web/e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: process.env.CI ? 'on' : 'retain-on-failure' },
  webServer: [
    {
      command: 'pnpm --filter @hometown/api exec tsx src/server.ts',
      url: `${apiUrl}/health/ready`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: { ...process.env, NODE_ENV: 'test', PORT: apiPort, DATA_STORE: 'memory', QUEUE_DRIVER: 'memory', PAYMENT_PROVIDER: 'mock', COMMUNITY_FULFILLMENT_ENABLED: 'true', PLATFORM_PROCUREMENT_ENABLED: 'true', DEFAULT_BUSINESS_MODEL_VERSION: 'PLATFORM_COMMUNITY' },
    },
    {
      command: 'pnpm --filter @hometown/admin-web dev',
      url: 'http://127.0.0.1:5173',
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: { ...process.env, VITE_AUTH_MODE: 'bearer', VITE_API_TARGET: apiUrl },
    },
  ],
});
