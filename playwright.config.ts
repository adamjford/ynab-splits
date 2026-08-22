import { defineConfig, devices } from "@playwright/test";

const e2eAppPort = process.env.E2E_APP_PORT ?? "3000";
const e2eFakePort = process.env.E2E_FAKE_PORT ?? "4010";
const instanceId = process.env.INSTANCE_ID ?? "e2e";
const instanceLabel = process.env.INSTANCE_LABEL ?? "e2e";
const cookiePrefix = process.env.COOKIE_PREFIX ?? `ynab_splits_${instanceId}`;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${e2eAppPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]] : "list",
  outputDir: "test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm exec tsx e2e/test-server.ts",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          E2E_APP_PORT: e2eAppPort,
          E2E_FAKE_PORT: e2eFakePort,
          INSTANCE_ID: instanceId,
          INSTANCE_LABEL: instanceLabel,
          COOKIE_PREFIX: cookiePrefix,
        },
      },
});
