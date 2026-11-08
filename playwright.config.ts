import { defineConfig, devices } from "@playwright/test";

const chrome = process.env.PW_CHROME_PATH ? { executablePath: process.env.PW_CHROME_PATH } : {};

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e.json" }]],
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure", launchOptions: chrome },
  webServer: process.env.BASE_URL ? undefined : { command: "npm run build && npm run start", url: "http://localhost:3000/sign-in", reuseExistingServer: true, timeout: 240_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { viewport: { width: 820, height: 1180 }, hasTouch: true }, testMatch: /a11y/ },
    { name: "mobile", use: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true }, testMatch: /a11y/ },
  ],
});
