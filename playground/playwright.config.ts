import { defineConfig, devices } from "@playwright/test"

// E2E / self-test harness. Drives a locally running frontend headlessly.
// Default target is the committed frontend dev port; override with E2E_BASE_URL
// (e.g. when the agent remaps ports.ts for an isolated autonomous run — see the
// "self-test-prefer-headless-automation" / "autonomous-test-isolate-ports" notes).
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:41730"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // WebKit ≈ Mobile Safari for this iOS-PWA (desktop WebKit engine, NOT a real
    // device — escalate device-only quirks to the iOS Simulator).
    { name: "webkit", use: { ...devices["iPhone 13"] } },
  ],
  // Reuse a dev server if one is already up; otherwise boot the frontend.
  webServer: {
    command: "pnpm --filter @repo/frontend dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
