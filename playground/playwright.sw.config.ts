import { defineConfig, devices } from "@playwright/test"

/*
 * Service-worker E2E. A SEPARATE config from `playwright.config.ts`, and it has
 * to be.
 *
 * The main harness drives `vite` — dev, where adaptv actively DESTROYS any
 * service worker (`docs/design/rendering.md §3.1`). Everything the worker does therefore
 * ships untested by that suite, which is exactly how the navigation denylist
 * drifted from its own documentation: the code said one thing, the doc said
 * another, and nothing in CI could tell them apart.
 *
 * So this one BUILDS and serves the built output. It is slower, and that is the
 * price of testing the thing that actually ships.
 *
 * Override the port with E2E_SW_PORT when running two worktrees at once — the
 * default collides, same as the main harness.
 */
//Explicit, so a spec never has to guess which build it is looking at — and so a
//leftover `ADAPTV_RENDER=spa` in the shell cannot silently turn this run into a
//second copy of the spa suite.
process.env.ADAPTV_RENDER = "ssr"

const port = Number(process.env.E2E_SW_PORT ?? 41750)
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: "./e2e-sw",
  //`update-prompt.spec.ts` asserts the OPPOSITE of `update.spec.ts` — nothing is
  //applied without user intent — and which of the two is correct is decided by
  //the build, not the spec. It belongs to `playwright.sw-prompt.config.ts` and
  //fails here by construction.
  testIgnore: "update-prompt.spec.ts",
  //Registrations are per-context, so tests do not share worker state — but they
  //do share one preview server, and several of them take it offline.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  //No retries, here least of all (#57 settled this for the main suite). This
  //suite has a KNOWN intermittent — `update.spec.ts` on Chromium, ~1 run in 3-5,
  //not root-caused — and a single CI retry is precisely what would turn it into a
  //green run and delete the only evidence that it is still there.
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // WebKit ≈ Mobile Safari, the actual target for an installed PWA. Not a real
    // device — escalate device-only quirks to the iOS Simulator.
    { name: "webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    //build THEN preview: `vite preview` serves whatever is on disk, so without
    //the build a green run can be measuring the previous commit's worker.
    command: `pnpm run build && pnpm exec vite preview --port ${port} --strictPort`,
    //`cwd` is resolved against THIS config file, so the server can only ever be
    //the app next to it. It used to be `pnpm --filter @repo/frontend`, which
    //matches by package NAME: any second workspace member under `apps/*` calling
    //itself `@repo/frontend` makes the filter fan out, and each copy raced this
    //same `--strictPort`. The losers die with EADDRINUSE — and if a copy had won,
    //the whole suite would have run green against the wrong app.
    cwd: "apps/frontend",
    url: baseURL,
    //never reuse: a server already up is a server built from unknown source, and
    //this suite exists to catch exactly that kind of silent staleness
    reuseExistingServer: false,
    timeout: 240_000,
  },
})
