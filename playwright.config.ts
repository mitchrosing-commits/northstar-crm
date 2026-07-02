import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 180_000,
    url: "http://127.0.0.1:3100/api/health"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
