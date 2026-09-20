import { defineConfig, devices } from "@playwright/test"

/*
 * A `render: "spa"` build deployed under a subpath — the GitHub Pages project
 * site, where the app lives at `/<repo>/` and the origin root is somebody else's.
 * → `docs/decisions/register.md` B1
 *
 * A fourth config rather than a project in the spa one, because the base is
 * compiled in exactly like `render` is: every URL the shell, the manifest and the
 * worker carry is written at build time, so a build is either rooted at `/` or at
 * `/app/`. And the other specs cannot run here, because they navigate by
 * root-absolute path (`page.goto("/lab")`), which under this base is outside the
 * app by definition. So `testMatch` is the one spec written for it.
 *
 * Served by `e2e-sw/subpath-host.ts`, not `vite preview`: preview answers
 * `/app/settings` with a 200 document of its own (MEASURED, 78 KB), and a static
 * host has no such file and answers `404.html` with a 404. The deep link is the
 * case this config exists for.
 */
process.env.ADAPTV_RENDER = "spa"

//The mount, trailing slash included the way a Pages URL is written. Restated in
//`subpath.spec.ts`, which cannot import a config without re-running it.
const SUBPATH = "/app/"

const port = Number(process.env.E2E_SW_SUBPATH_PORT ?? 41780)
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: "./e2e-sw",
  testMatch: "subpath.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  //No retries — #57's rule, and `playwright.sw.config.ts` says why it matters
  //double for this suite.
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    //build THEN serve, for the same reason as every other worker config: the host
    //serves whatever is on disk
    command: `pnpm exec vite build --base ${SUBPATH} && pnpm exec tsx ../../e2e-sw/subpath-host.ts dist/client ${port} ${SUBPATH}`,
    //resolved against this file, so the server is always the app next to it —
    //see `playwright.sw.config.ts`
    cwd: "apps/frontend",
    url: `${baseURL}${SUBPATH}`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
})
