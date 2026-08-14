import { expect, test } from "@playwright/test"
import {
  bootControlled,
  engineReportsServiceWorker,
  FILE_FIXTURES,
  navigateInIsolation,
  RENDER,
  ROUTE,
  workerState,
} from "./sw"

/*
 * What the worker is allowed to CLAIM.
 *
 * The regression net for a bug that shipped while the docs said it was fixed:
 * `mode: "navigate"` is what a browser sends for a plain LINK to a file, so
 * without a file heuristic the SW answers `/sw-probe.pdf` with the app shell.
 *
 * Read the `spa` assertions as the real ones. Under `ssr` a navigation reaches
 * the network whatever the worker decides, so the file fixtures come back correct
 * either way — that mode can only catch the OFFLINE half (see offline.spec.ts).
 */

test.describe(`navigation claiming (render: ${RENDER})`, () => {
  test(`serves ${ROUTE} from the worker`, async ({
    page,
    browserName,
  }) => {
    await bootControlled(page)
    const result = await navigateInIsolation(page, ROUTE)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    //THE CONTROL for every "not claimed" assertion in this file. Without it they
    //are equally consistent with the worker having stopped claiming anything.
    if (RENDER === "spa") {
      //served out of Cache Storage — engine-independent, and true in WebKit too
      expect(result.transferSize).toBe(0)
    } else if (engineReportsServiceWorker(browserName)) {
      expect(result.fromServiceWorker).toBe(true)
      //...and still from the network, which is the whole point of ssr
      expect(result.transferSize).toBeGreaterThan(0)
    } else {
      test.skip(true, "Playwright WebKit never reports fromServiceWorker")
    }
    expect(result.contentType).toContain("text/html")
  })

  for (const file of FILE_FIXTURES) {
    test(`never answers ${file} with the app shell`, async ({ page }) => {
      await bootControlled(page)
      const result = await navigateInIsolation(page, file)

      if (!result.ok) {
        //Chromium hands a PDF to its download manager and aborts the navigation.
        //That IS the pass: the browser, not the worker, decided what it was.
        return
      }
      expect(
        result.contentType,
        `the SW answered a file link with ${result.contentType}`,
      ).not.toContain("text/html")
      expect(
        result.isAppDocument,
        "served the app shell for a file link",
      ).toBe(false)
      if (RENDER === "spa") {
        //the decisive one: a shell-served response is a precache hit, so anything
        //above zero means the request went to the origin, as a file must
        expect(result.transferSize).toBeGreaterThan(0)
      }
    })
  }

  test("a dot before the last segment is still a navigation", async ({
    page,
    browserName,
  }) => {
    //the heuristic's cost is bounded on purpose — `/v1.2/docs` is a route, and an
    //over-eager rule would silently drop the SW for whole versioned URL trees
    await bootControlled(page)
    const result = await navigateInIsolation(page, "/v1.2/docs")
    expect(result.ok).toBe(true)
    if (!result.ok) return

    if (RENDER === "spa") {
      expect(result.transferSize).toBe(0)
    } else if (engineReportsServiceWorker(browserName)) {
      expect(result.fromServiceWorker).toBe(true)
    } else {
      test.skip(true, "Playwright WebKit never reports fromServiceWorker")
    }
  })
})

test.describe(`navigation preload (render: ${RENDER})`, () => {
  test("matches the render mode", async ({ page }) => {
    await bootControlled(page)
    const state = await workerState(page)

    if (state.preloadEnabled === null) {
      test.skip(true, "this engine has no navigationPreload API")
      return
    }
    //ssr consumes `event.preloadResponse`, so preload is a win. spa answers every
    //navigation from the precache, so an enabled preload would be a document
    //fetched for every navigation and thrown away — and the flag lives on the
    //REGISTRATION, so `spa` has to actively turn it off. → RENDERING.md §3.3
    expect(state.preloadEnabled).toBe(RENDER === "ssr")
  })

  test("the document comes from where the render mode says it should", async ({
    page,
  }) => {
    //ssr: >0, the per-request render survived. If this ever reads 0 the worker
    //started serving documents from storage — the cross-user leak §3.2 exists to
    //prevent, which is far worse than a slow navigation.
    //spa: 0, the shell came from the precache, which is what makes it work offline.
    await bootControlled(page)
    const transferSize = await page.evaluate(() => {
      const nav = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming
      return nav.transferSize
    })
    if (RENDER === "ssr") expect(transferSize).toBeGreaterThan(0)
    else expect(transferSize).toBe(0)
  })
})
