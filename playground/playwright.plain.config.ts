import { defineConfig, devices } from "@playwright/test"

/*
 * The component and precedence specs, against the lab app built with NO Tailwind
 * (`apps/frontend/vite.plain.config.ts`; docs/decisions/styling.md §0.1, §9).
 *
 * The same app and the same specs as `playwright.config.ts`, a different build: no
 * `@tailwindcss/vite`, and `@arrzdev/adaptv/styles.css` in place of `tailwind.css`. A
 * separate config rather than a project, because the two builds are two dev servers of
 * the same app directory. `no-tailwind.spec.ts` asserts the build really has no
 * Tailwind in it, and runs only here.
 *
 * Specs that are ABOUT Tailwind stay out: `cascade.spec.ts` (Tailwind's utilities
 * against adaptv's layers), `tailwind-empty-fallback.spec.ts`, `dev-css-flat.spec.ts`
 * (the shape of Tailwind's dev output). `style-precedence.spec.ts` drops its `tw` rows.
 */
//Set on the RUNNER, as `playwright.sw-spa.config.ts` does for its mode: the specs read
//it to pick which rows apply, and the dev server's own config sets it again.
process.env.PLAYGROUND_CSS = "plain"

const port = Number(process.env.E2E_PLAIN_PORT ?? 41780)
const baseURL =
  process.env.E2E_PLAIN_BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    //precedence: a plain class beats every default and moves no lock; the hover/active
    //correction reaches a stylesheet Tailwind never saw
    "style-precedence.spec.ts",
    "plain-css.spec.ts",
    "no-tailwind.spec.ts",
    //components
    "collapsible.spec.ts",
    "divider.spec.ts",
    "drawer-*.spec.ts",
    "dropdown.spec.ts",
    "fab.spec.ts",
    "field-group.spec.ts",
    "fields.spec.ts",
    "icon.spec.ts",
    "image.spec.ts",
    "link.spec.ts",
    "list.spec.ts",
    "press-states.spec.ts",
    "progress-bar.spec.ts",
    "pull-to-refresh.spec.ts",
    "radio-group.spec.ts",
    "select.spec.ts",
    "skeleton.spec.ts",
    "slider.spec.ts",
    "spinner.spec.ts",
    "swipeable.spec.ts",
    "text.spec.ts",
    "toggles.spec.ts",
    "wheel-column.spec.ts",
  ],
  //a test tagged `@tailwind` asserts a Tailwind utility, or measures a fixture that
  //Tailwind's classes lay out; this build has neither
  grepInvert: /@tailwind\b/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  //No retries — the main config says why.
  retries: 0,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: `pnpm exec vite --config vite.plain.config.ts --port ${port} --strictPort`,
    //resolved against THIS file, so the server is always the app next to it — the main
    //config explains the `--filter` hazard this avoids
    cwd: "apps/frontend",
    env: {
      VITE_APP_PORT: String(port),
    },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
