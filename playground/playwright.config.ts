import { defineConfig, devices } from "@playwright/test"

/*
 * E2E / self-test harness. Drives a locally running frontend headlessly.
 *
 * The port is ONE value, used for both the URL under test and the server this
 * config boots. It used to be written twice — and `reuseExistingServer` turns that
 * into a silent wrong-app run: worktrees all default to 41730, so if a sibling
 * worktree already has a dev server up, Playwright happily reuses it and every
 * assertion is measured against a different checkout. It shows up as mass
 * "element not found" on routes that plainly exist, which reads as a broken app.
 *
 * Override with E2E_PORT (or E2E_BASE_URL for a server this config must not boot)
 * when running two worktrees at once.
 */
const port = Number(process.env.E2E_PORT ?? 41730)
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  //No retries, anywhere. CI used to get one, and every timing-sensitive describe
  //carried `retries: 2` on top of it — which is how a hydration race that failed
  //the first test of every cold run stayed filed as "load flake" for as long as it
  //did. A retried test still reports green, so the signal was gone. If a test here
  //cannot pass on its first attempt it is telling you something; let it.
  retries: 0,
  //Under CI the line reporter says WHICH test failed and the HTML report, uploaded
  //as the job's artifact on failure, carries the trace that says why. Locally the
  //list is enough and the trace is on disk under test-results/.
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL,
    //Paired with `retries: 0` above: "on-first-retry" would mean there is never a
    //first retry to trace on, so every failure lands with no trace at all — the
    //opposite of what #57 wanted. Capture on the only attempt there is.
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // WebKit ≈ Mobile Safari for this iOS-PWA (desktop WebKit engine, NOT a real
    // device — escalate device-only quirks to the iOS Simulator).
    { name: "webkit", use: { ...devices["iPhone 13"] } },
  ],
  // Reuse a dev server if one is already up; otherwise boot the frontend.
  webServer: {
    //the inspector port has to move with the app port or the boot dies on an
    //EADDRINUSE for a port nobody asked about — see vite.config.ts
    command: `pnpm exec vite --port ${port} --strictPort`,
    //`cwd` is resolved against THIS config file, so the server can only ever be
    //the app next to it. It used to be `pnpm --filter @repo/frontend`, which
    //matches by package NAME — and the header above warns about reusing another
    //worktree's server. The same hazard exists WITHIN one worktree: a second
    //member under `apps/*` named `@repo/frontend` makes the filter fan out, and
    //whichever copy wins the port serves every assertion, silently.
    cwd: "apps/frontend",
    env: {
      VITE_APP_PORT: String(port),
      VITE_SUPERVISOR_PORT: String(port + 10),
    },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})

/*
 * ⚠︎ `webServer.command` was `pnpm --filter @repo/frontend dev` — a script that does
 * not exist (the frontend has `dev:web`/`dev:ios`/…, never a bare `dev`), so the
 * harness could never boot its own server and every run died with "Process from
 * config.webServer exited early". It only ever worked when a dev server happened to
 * be up already, which `reuseExistingServer` quietly papered over.
 *
 * It now runs plain `vite` rather than `dev:web`: that script is the adaptv CLI
 * wrapper, which owns an interactive TUI, a single-instance lock and native
 * launchers — none of which a headless browser needs, and all of which fight a
 * process manager. `vite.config.ts` still supplies the adaptv plugin, so the app
 * under test is the real one.
 */
