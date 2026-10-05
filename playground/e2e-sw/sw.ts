import { execFileSync } from "node:child_process"
import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

/**
 * Fixtures that exist for this suite, and why they are real files in `public/`.
 *
 * The navigation denylist is about what happens to a same-origin file that is
 * **not** in the precache manifest. `.pdf` and `.xml` are outside the precache
 * glob (`{js,css,ico,png,svg,woff2,json,txt}` — `sw-helpers.ts`), so they are the
 * only honest way to test it. A route that merely 404s is not the same thing.
 */
export const FILE_FIXTURES = ["/sitemap.xml", "/sw-probe.pdf"] as const

/** A route that exists. The control for every "the SW declined it" assertion. */
export const ROUTE = "/settings"

/** Which build this run is measuring. Set by the config, not by the shell. */
export const RENDER: "ssr" | "spa" =
  process.env.ADAPTV_RENDER === "spa" ? "spa" : "ssr"

/*
 * What each engine can honestly be asked, MEASURED rather than assumed.
 *
 * Playwright's WebKit reports `fromServiceWorker: false` for every response —
 * including `/settings` on a controlled page, which the worker demonstrably
 * served. Asserting on it there would fail a working build; asserting the
 * opposite would bake the gap in as correct. So the specs use `transferSize`
 * where they can and skip, loudly, where they cannot.
 *
 * `setOffline` is worse: in WebKit a navigation afterwards dies with "WebKit
 * encountered an internal error" before the worker is ever consulted. Offline
 * behaviour on WebKit is therefore NOT covered here and must be walked on the
 * iOS Simulator, which is the real target anyway.
 */
export function engineReportsServiceWorker(browserName: string): boolean {
  return browserName !== "webkit"
}

export function engineSupportsOffline(browserName: string): boolean {
  return browserName !== "webkit"
}

/**
 * Ship a new version of the app over the one the preview server is serving.
 *
 * A real `vite build`, not a hand-edited artifact: the update path's whole job is
 * to notice that the bytes at `/sw.js` changed, and the only honest way to produce
 * that is the command a deploy actually runs.
 *
 * `ADAPTV_BUILD_TAG` is what makes it cheap. The tag is normally a content hash of
 * the client output (`build-tag.ts`), so a rebuild of unchanged sources is
 * byte-identical and the browser correctly sees NO update. Overriding it changes
 * the one constant compiled into the worker, which is exactly a deploy's shape —
 * new worker, same assets — while leaving the precache revisions alone so the
 * new worker installs in a moment.
 *
 * `workspaceRoot` comes from `testInfo.config.rootDir`, which is the resolved
 * `testDir` — `playground/e2e-sw` — and NOT the directory the config file lives
 * in. Measured with `playwright test --list --reporter=json`, which prints it.
 * The name still holds because `pnpm --filter` matches by package NAME and finds
 * the workspace by walking UP from its cwd, so any directory inside the repo
 * works. Anything keyed on the PATH instead — a `--filter ./apps/frontend`, a
 * `join(root, "apps/frontend")` — resolves one level too deep, matches no
 * package, and pnpm exits 0 having built nothing.
 *
 * Not `process.cwd()`, which is wherever the developer happened to be standing,
 * and not `import.meta.dirname`, which Playwright's CJS transpile does not have.
 *
 * `buildArgs` go to `vite build` — for a deploy that must change the CLIENT's
 * bytes too, which the tag alone never does (`stale-chunk.spec.ts`).
 */
export function deploy(
  buildTag: string,
  workspaceRoot: string,
  buildArgs: readonly string[] = [],
): void {
  execFileSync(
    "pnpm",
    ["--filter", "@repo/frontend", "run", "build", ...buildArgs],
    {
      cwd: workspaceRoot,
      //ADAPTV_RENDER is already on the environment, set by the config — the new
      //build has to be the same MODE as the one it replaces, or this stops being an
      //update and becomes a different app.
      env: { ...process.env, ADAPTV_BUILD_TAG: buildTag },
      stdio: "pipe",
      timeout: 240_000,
    },
  )
}

/**
 * Load the app and wait until a service worker is actually **controlling** it.
 *
 * Two loads, deliberately. The first install claims the page mid-session, so the
 * document it is looking at was fetched with no worker in the path — asserting
 * navigation behaviour there measures the browser, not adaptv. The second load is
 * the first one the worker actually served.
 */
export async function bootControlled(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "load" })
  await page.waitForFunction(
    () => !!navigator.serviceWorker.controller,
    null,
    {
      timeout: 30_000,
    },
  )
  await page.goto("/", { waitUntil: "load" })
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true)
}

/**
 * Resolve once the head links an icon. Under `spa` the shell's head has none: the
 * client writes them after `load`, so a spec that reads the head straight after
 * `bootControlled` can see none at all.
 */
export async function awaitHeadIcons(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page
          .locator(
            'head link[rel~="icon"], head link[rel="apple-touch-icon"]',
          )
          .count(),
      { message: "the head never linked an icon", timeout: 20_000 },
    )
    .toBeGreaterThan(0)
}

/** What the browser knows about the registration, as plain data. */
export function workerState(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    const preload = registration.navigationPreload
      ? await registration.navigationPreload.getState().catch(() => null)
      : null
    const cacheNames = await caches.keys()
    const precacheName = cacheNames.find((name) =>
      name.includes("precache"),
    )
    const precached = precacheName
      ? (await (await caches.open(precacheName)).keys()).map((r) => r.url)
      : []
    return {
      controlled: !!navigator.serviceWorker.controller,
      active: registration.active?.state ?? null,
      preloadEnabled: preload?.enabled ?? null,
      cacheNames,
      precachedCount: precached.length,
      precached,
    }
  })
}

/**
 * Navigate and report who answered.
 *
 * A failed navigation leaves Chromium loading `chrome-error://`, which then races
 * whatever comes next and surfaces as "interrupted by another navigation" on the
 * *following* assertion — a false failure that reads exactly like a regression.
 * A fresh page per navigation is the fix; the registration lives on the context,
 * so the worker still controls it.
 */
export async function navigateInIsolation(page: Page, path: string) {
  const tab = await page.context().newPage()
  try {
    const response = await tab.goto(path, {
      waitUntil: "domcontentloaded",
    })
    const html = await tab.content()
    //0 means the document came out of Cache Storage. In `spa` that is the
    //engine-independent proof that the worker CLAIMED the navigation — which
    //matters because `fromServiceWorker` is unusable in WebKit — see
    //`engineReportsServiceWorker` above.
    const transferSize = await tab
      .evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as
          | PerformanceNavigationTiming
          | undefined
        return nav?.transferSize ?? null
      })
      .catch(() => null)
    return {
      ok: true as const,
      //where it ENDED UP, which is not where it was sent for anything that
      //redirects — the only way to tell a followed redirect from a swallowed one
      url: new URL(tab.url()).pathname,
      status: response?.status() ?? null,
      contentType: response?.headers()["content-type"] ?? "",
      fromServiceWorker: response?.fromServiceWorker() ?? false,
      transferSize,
      //NOT `/<html/` — Chromium renders XML inside its own HTML viewer, so a
      //perfectly correct `application/xml` response reads as HTML by that test.
      //The question is only ever "is this OUR shell", so ask that.
      isAppDocument: /id="root"|data-adaptv-splash/.test(html),
      html,
    }
  } catch (error) {
    //Chromium aborts the navigation when it hands a body to the download manager,
    //and both engines abort when the network is genuinely gone. Both are "the SW
    //did not answer this with a document", which is what the caller is asking.
    return { ok: false as const, reason: String(error).split("\n")[0] }
  } finally {
    await tab.close()
  }
}
