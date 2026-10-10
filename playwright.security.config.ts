import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./apps/admin-web/e2e", testMatch: "web-security.spec.ts", workers: 1,
  reporter: "list", outputDir: ".audit/security-browser-20261010", use: { trace: "retain-on-failure" },
});
