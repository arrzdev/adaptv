import { defineConfig, devices } from "@playwright/test"

//The site's smoke, run by `pnpm --dir website test:e2e`. It drives the PRODUCTION build:
//the webServer builds the site (`adaptv build web`) and serves the output with `vite preview`,
//which is what `adaptv preview web` runs, minus the CLI's detached server: that one outlives
//Playwright's SIGKILL and holds the port for the next run. What is asserted is what the
//Worker ships, not what `dev` renders.
//
//The port is one value used for both the URL under test and the server this config boots
//(the playground's config explains the silent wrong-app run two values allow). Override
//with E2E_PORT, or E2E_BASE_URL for a server this config must not boot.
const port = Number(process.env.E2E_PORT ?? 41765)
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: "./e2e",
  //No retries, anywhere: a retried test reports green and hides the flake.
  retries: 0,
  forbidOnly: !!process.env.CI,
  //the build is memory-heavy and the VM is small
  workers: 1,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  //chromium only: WebKit and Firefox are out of scope for this smoke
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command:
          "node_modules/.bin/adaptv build web && exec node_modules/.bin/vite preview",
        url: baseURL,
        env: { VITE_APP_PORT: String(port) },
        //never reuse: a sibling checkout's server would be measured as this one
        reuseExistingServer: false,
        //a cold production build
        timeout: 600_000,
      },
})
