import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The stale-chunk net under a storm — many `vite:preloadError` events, one
 * reload, never a loop, on both engines.
 *
 * `src/shell/preload-error-recovery.ts` settles the contract: the first error
 * reloads once and stamps the time in `sessionStorage`; every further error in
 * the same document is left alone while that reload is on its way; an error in
 * the document the reload produced, inside the 30 s window, is unrecoverable and
 * draws the offline screen instead of reloading again; a stamp older than the
 * window is a later deploy and gets its own reload.
 *
 * The event is dispatched by the test — the same `vite:preloadError` Vite's
 * preload helper raises, with `cancelable` so `preventDefault` is observable.
 * Document loads are counted by an init script in `sessionStorage`, which
 * survives the reload the net performs, so "exactly one reload" is a number:
 * the count after the storm is the count before it plus one. The count is read
 * as a baseline rather than assumed to be 1, because the dev server itself can
 * reload a document once while it boots (WebKit was seen at 2 after one
 * `goto`, with the app's own stamp still unset); the storm's reload is the
 * delta, and the app's guard stamp being null is the premise that no recovery
 * happened before it.
 *
 * The net calls `location.reload()` inside the dispatch, and Chromium tears the
 * evaluation context down before the storm's return value crosses back. So the
 * storm writes what it cancelled into `sessionStorage` too, and a storm that
 * reloads is read from there after the new document took over.
 */

const LOADS_KEY = "stress:preload-loads"
const CANCELLED_KEY = "stress:preload-cancelled"
const GUARD_KEY = "adaptv:preload-error-reload"

function countLoads(key: string) {
  const loads = Number(sessionStorage.getItem(key) ?? "0")
  sessionStorage.setItem(key, String(loads + 1))
}

const loads = (page: Page) =>
  page.evaluate(
    (key) => Number(sessionStorage.getItem(key) ?? "0"),
    LOADS_KEY,
  )

/** `loads` while the reload may still be tearing the context down: -1 then. */
const loadsOrReloading = (page: Page) =>
  loads(page).catch((error: Error) => {
    if (/Execution context was destroyed/.test(error.message)) return -1
    throw error
  })

/**
 * Dispatch N stale-chunk errors back to back. Resolves to how many were
 * cancelled, or to null when the net reloaded the document under the call —
 * then `cancelledInStorm` reads the same number from storage.
 */
const storm = (page: Page, count: number) =>
  page
    .evaluate(
      ([count, key]) => {
        let cancelled = 0
        for (let index = 0; index < count; index += 1) {
          const event = new Event("vite:preloadError", {
            cancelable: true,
          })
          if (!window.dispatchEvent(event)) cancelled += 1
        }
        sessionStorage.setItem(key, String(cancelled))
        return cancelled
      },
      [count, CANCELLED_KEY] as const,
    )
    .catch((error: Error) => {
      if (/Execution context was destroyed/.test(error.message))
        return null
      throw error
    })

const cancelledInStorm = (page: Page) =>
  page.evaluate(
    (key) => Number(sessionStorage.getItem(key) ?? "-1"),
    CANCELLED_KEY,
  )

const guardStamp = (page: Page) =>
  page.evaluate((key) => sessionStorage.getItem(key), GUARD_KEY)

const offline = (page: Page) =>
  page.getByRole("alert").filter({ hasText: "You're offline" })

/** Storm once, and wait for the one reload it must cause. */
async function stormAndReload(page: Page, count: number, base: number) {
  await storm(page, count)
  await expect
    .poll(() => loadsOrReloading(page), { message: "one reload" })
    .toBe(base + 1)
  await awaitClientHandover(page)
  expect(await loads(page)).toBe(base + 1)
}

test.describe("Stale-chunk recovery under a storm", () => {
  let base = 0

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(countLoads, LOADS_KEY)
    await page.goto("/lab/hooks")
    await awaitClientHandover(page)
    base = await loads(page)
    expect(base).toBeGreaterThanOrEqual(1)
    test.info().annotations.push({
      type: "loads before the storm",
      description: String(base),
    })
    expect(
      await guardStamp(page),
      "no recovery before the storm",
    ).toBeNull()
  })

  test("twenty errors at once are one reload, and the reloaded document is left alone", async ({
    page,
  }) => {
    await stormAndReload(page, 20, base)
    //the reloading document leaves every error as the engine raised it
    expect(await cancelledInStorm(page)).toBe(0)
    expect(await guardStamp(page)).not.toBeNull()
    await expect(offline(page)).toHaveCount(0)
  })

  test("an error inside the window after the reload is the offline screen, not a second reload", async ({
    page,
  }) => {
    await stormAndReload(page, 1, base)

    const cancelled = await storm(page, 5)
    //the unrecoverable case is the one the net takes over: prevented, once
    //per error, and drawn as the offline screen
    expect(cancelled).toBe(5)
    await expect(offline(page)).toBeVisible()
    //and it is still the same document: no loop
    expect(await loads(page)).toBe(base + 1)
    expect(await storm(page, 20)).toBe(20)
    expect(await loads(page)).toBe(base + 1)
    await expect(offline(page)).toHaveCount(1)
  })

  test("a stamp older than the window is a later deploy, and gets its own reload", async ({
    page,
  }) => {
    await page.evaluate(
      ([key, at]) => sessionStorage.setItem(key, String(at)),
      [GUARD_KEY, Date.now() - 31_000] as const,
    )
    await stormAndReload(page, 1, base)
    await expect(offline(page)).toHaveCount(0)
    const stamp = Number(await guardStamp(page))
    expect(Date.now() - stamp).toBeLessThan(30_000)
  })

  test("the router's own reload keys are cleared by the recovery reload", async ({
    page,
  }) => {
    await page.evaluate(() => {
      sessionStorage.setItem("tanstack_router_reload:one", "1")
      sessionStorage.setItem("tanstack_router_reload:two", "1")
    })
    await stormAndReload(page, 1, base)
    const keys = await page.evaluate(() =>
      Array.from({ length: sessionStorage.length }, (_, index) =>
        sessionStorage.key(index),
      ).filter((key) => key?.startsWith("tanstack_router_reload:")),
    )
    expect(keys).toEqual([])
  })
})
