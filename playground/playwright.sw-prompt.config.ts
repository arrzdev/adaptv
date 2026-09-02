import { defineConfig, devices } from "@playwright/test"

/*
 * The `serviceWorkerUpdate: "prompt"` build.
 *
 * A third config rather than a third spec in the ssr one, because the policy is
 * COMPILED IN: `virtual:adaptv/pwa-register` bakes it to a constant, so a build
 * is either `auto` or `prompt` and no test can switch between them. The two are
 * mutually exclusive at runtime — `update.spec.ts` asserts a waiting worker is
 * applied at launch, and this build's whole contract is that it is NOT — which is
 * why `testMatch` below is a single file rather than the directory.
 *
 * `ssr` is deliberate: the update path is identical in both render modes (it is
 * registration behaviour, not navigation behaviour), so building `spa` as well
 * would double the slowest part of the suite to re-measure the same thing.
 */
process.env.ADAPTV_RENDER = "ssr"
process.env.ADAPTV_SW_UPDATE = "prompt"

const port = Number(process.env.E2E_SW_PROMPT_PORT ?? 41770)
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: "./e2e-sw",
  //the only spec whose expectations are inverted by this build
  testMatch: "update-prompt.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  //No retries — #57's rule, and `playwright.sw.config.ts` says why it matters
  //double for this suite. `on-first-retry` would never fire with none.
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: `pnpm run build && pnpm exec vite preview --port ${port} --strictPort`,
    //`cwd` is resolved against THIS config file, so the server can only ever be
    //the app next to it. It used to be `pnpm --filter @repo/frontend`, which
    //matches by package NAME: any second workspace member under `apps/*` calling
    //itself `@repo/frontend` makes the filter fan out, and each copy raced this
    //same `--strictPort`. The losers die with EADDRINUSE — and if a copy had won,
    //the whole suite would have run green against the wrong app.
    cwd: "apps/frontend",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240_000,
  },
})
