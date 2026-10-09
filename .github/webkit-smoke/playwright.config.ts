import { defineConfig, devices } from "@playwright/test"

// iPhone 15: a 393x852 viewport, touch on, the iOS Safari user agent. Playwright's WebKit
// is not Safari on a phone, but it is the same engine family and the real viewport size.
const port = Number(process.env.SMOKE_PORT ?? 4173)

export default defineConfig({
  testDir: ".",
  testMatch: "phone.smoke.ts",
  // Playwright empties its outputDir, so it is not the directory the screenshots go to.
  outputDir: `${process.env.SMOKE_OUT ?? "."}/test-results`,
  // WebKit on a software-rendered VM or runner hydrates slowly; a real failure still fails.
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["iPhone 15"],
    baseURL: `http://127.0.0.1:${port}`,
  },
  projects: [{ name: "webkit-iphone-15" }],
})
