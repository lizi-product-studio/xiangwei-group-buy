import { defineConfig } from "@playwright/test";

const apiPort = process.env.E2E_API_PORT ?? "3101";
const apiUrl = `http://127.0.0.1:${apiPort}`;
const adminPort = process.env.E2E_ADMIN_PORT ?? "5174";
const adminUrl = `http://127.0.0.1:${adminPort}`;

export default defineConfig({
  testDir: "./apps/admin-web/e2e",
  testIgnore: "**/web-security.spec.ts",
  timeout: 60_000,
  fullyParallel: false,
  // The memory-backed E2E server intentionally keeps one product aggregate;
  // independent browser journeys must not mutate that aggregate concurrently.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: adminUrl,
    trace: process.env.CI ? "on" : "retain-on-failure",
  },
  webServer: [
    {
      // Invoke Node's loader directly. The tsx CLI creates an IPC control pipe,
      // which is unnecessary for a one-shot test server and is blocked in some CI sandboxes.
      command:
        "pnpm --filter @hometown/api exec node --import tsx src/server.ts",
      url: `${apiUrl}/health/ready`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: apiPort,
        DATA_STORE: "memory",
        QUEUE_DRIVER: "memory",
        PAYMENT_PROVIDER: "mock",
        // The serial end-to-end suite creates independent role journeys in one
        // in-memory process. Keep production rate limiting intact while
        // preventing a previous journey from turning later assertions into
        // unrelated rate-limit failures.
        RATE_LIMIT_MAX: "10000",
        STAFF_CHALLENGE_BITS: "8",
      },
    },
    {
      command: `pnpm --filter @hometown/admin-web exec vite --host 127.0.0.1 --port ${adminPort}`,
      url: adminUrl,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        // Keep the Vite/Ant Design runtime out of NODE_ENV=test. rc-util's
        // test-only useId fallback reuses one id for every modal, which makes
        // otherwise distinct dialog locators ambiguous in browser tests.
        NODE_ENV: "development",
        VITE_AUTH_MODE: "bearer",
        VITE_API_TARGET: apiUrl,
      },
    },
  ],
});
