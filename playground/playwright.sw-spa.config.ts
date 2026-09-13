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
    //A static host, not `vite preview`: the preview renders every navigation on
    //the server whatever `render` says, so a first visit never booted the shell
    //this build ships. A spa build lands in `dist/client`, emptied first so a
    //build that ever wrote elsewhere fails the host's start instead of serving
    //a stale copy. `deploy()` rebuilds in place. → e2e-sw/static-host.mjs
    command: `rm -rf dist/client && pnpm run build && node ../../e2e-sw/static-host.mjs dist/client ${port}`,
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
