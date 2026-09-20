import { defineConfig, devices } from "@playwright/test"

/*
 * The same service-worker suite, against the `ssr` build run the production way:
 * `node .output/server/index.mjs`, not `vite preview`.
 *
 * It is a different server, and the difference already shipped a bug. Preview
 * reads the output directory per request. The built node server answers static
 * files from a table baked into its bundle when it was built, so a file written
 * after that bundle is on disk and 404s. That is how `/sw.js` and
 * `/adaptv-shell.html` went missing from every production SSR deploy — no worker
 * ever installed — while `playwright.sw.config.ts` stayed green.
 */
//Explicit, like the preview config: the build reads it, and so do the specs.
process.env.ADAPTV_RENDER = "ssr"

const port = Number(process.env.E2E_SW_NODE_PORT ?? 41780)
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: "./e2e-sw",
  //Both update specs `deploy()` a new build under a server that keeps running,
  //which is a preview property: this server baked its table and its code at
  //start, so a production deploy is a restart. The prompt spec also needs its
  //own build (`playwright.sw-prompt.config.ts`).
  testIgnore: ["update.spec.ts", "update-prompt.spec.ts"],
  //one server, and several specs take it offline — see `playwright.sw.config.ts`
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  //No retries — #57's rule; `playwright.sw.config.ts` says why it matters double here.
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    //build THEN serve, for the same reason as the preview config: the server
    //runs whatever is on disk, and without the build that is the last commit's
    //The preset is pinned because a leftover `NITRO_PRESET` or a detected provider
    //would emit no `.output/server/index.mjs`, and `NITRO_PORT` because the server
    //reads it before `PORT`: a stale one in the shell would win in silence.
    command: `NITRO_PRESET=node-server pnpm run build && NITRO_PORT=${port} node .output/server/index.mjs`,
    //resolved against this file — see `playwright.sw.config.ts` for why not a filter
    cwd: "apps/frontend",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240_000,
  },
})
