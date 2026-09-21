import { defineConfig, devices } from "@playwright/test"

/*
 * The STRESS suite: `e2e/stress-*.spec.ts`, which the main config ignores.
 *
 * These specs drive hundreds of gesture cycles, sample the heap over CDP, count
 * rAF frames at rest and throttle the CPU. Every one of those measurements is of
 * the page under this run's load and nothing else, so they run alone: one
 * worker, no parallelism, the same server as the main harness. Everything else
 * is the main config's shape — the port, no retries, the reporter, the two
 * engines — so a spec moves between the two suites without changing.
 */
const port = Number(process.env.E2E_PORT ?? 41730)
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: "./e2e",
  //anchored to the file name (the pattern is tested against the absolute path;
  //see the main config's testIgnore)
  testMatch: /[\\/]stress-[^\\/]*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  //No retries (the main config says why). A stress measurement that passes on
  //its second attempt has measured a warm page, which is not the claim.
  retries: 0,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    cwd: "apps/frontend",
    env: { VITE_APP_PORT: String(port) },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
