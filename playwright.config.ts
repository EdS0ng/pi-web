import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // Each worker boots its own isolated PI WEB stack (sessiond + API + Vite).
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium", trace: "retain-on-failure" },
    },
  ],
});
