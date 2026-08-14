import { defineConfig, devices } from "@playwright/test"

/*
 * The same service-worker suite, against a `render: "spa"` build.
 *
 * A separate config rather than a second project, because the two modes are
 * separate BUILDS of the same app directory and running them concurrently would
 * have them clobbering each other's generated output.
 *
 * It is not optional coverage. Under `ssr` a navigation goes to the network
 * whatever the worker decides, so a worker that wrongly claims `/whitepaper.pdf`
 * still returns a PDF and the suite stays green. Under `spa` the same worker
 * answers it from the precache with the app shell's HTML — online. The bug that
 * prompted this suite was only ever visible here.
 */
//Set on the RUNNER, not just the server: the build reads it, and so do the specs
//when they pick which assertions are meaningful for this mode. `webServer.env`
//alone would leave the tests thinking they were looking at an ssr build.
process.env.ADAPTV_RENDER = "spa"

const port = Number(process.env.E2E_SW_SPA_PORT ?? 41760)
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: "./e2e-sw",
  //belongs to `playwright.sw-prompt.config.ts`, whose build inverts it — see the
  //note there
  testIgnore: "update-prompt.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: `pnpm --filter @repo/frontend run build && pnpm --filter @repo/frontend exec vite preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240_000,
  },
})
