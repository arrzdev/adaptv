import { expect, test } from "@playwright/test"
import {
  bootControlled,
  engineReportsServiceWorker,
  engineSupportsOffline,
  FILE_FIXTURES,
  navigateInIsolation,
  RENDER,
} from "./sw"

/*
 * Offline is a RENDER outcome, not a redirect to an offline page.
 *
 * The shell boots React, the router resolves `location.pathname`, the route's
 * chunk comes out of the precache, and the route renders its own offline UI in
 * place. This suite proves the delivery half of that: the document and the chunks
 * are there without a network.
 *
 * Both modes reach the same place by different routes — `spa` was already serving
 * the shell, `ssr` falls back to it once the network misses its deadline — so this
 * is the one file where the ssr build tests the denylist for real: online, a file
 * link is passed through either way, but offline the fallback is the only thing
 * that could answer it, and it must decline.
 */

test.describe(`offline (render: ${RENDER})`, () => {
  test.skip(
    ({ browserName }) => !engineSupportsOffline(browserName),
    "Playwright WebKit dies with an internal error on any navigation after setOffline — measured, and before the worker is consulted. iOS offline is walked on the Simulator instead.",
  )

  test.beforeEach(async ({ page, context }) => {
    await bootControlled(page)
    await context.setOffline(true)
  })

  test("a NEVER-VISITED route still boots", async ({
    page,
    browserName,
  }) => {
    //never-visited is the whole point: if it only worked for pages already seen,
    //the precache would be doing nothing that the HTTP cache does not
    const result = await navigateInIsolation(page, "/lab")
    expect(
      result.ok,
      `offline boot failed: ${!result.ok && result.reason}`,
    ).toBe(true)
    if (!result.ok) return
    if (engineReportsServiceWorker(browserName)) {
      expect(result.fromServiceWorker).toBe(true)
    }
    expect(result.transferSize).toBe(0)
    expect(result.isAppDocument).toBe(true)
  })

  test("every icon the page links still loads", async ({ page }) => {
    //The precache carries only the linked icons now, so the linked ones are the
    //ones that must survive the network going away. Read off the head, fetched
    //through the worker with the origin down (the control below).
    const results = await page.evaluate(async () => {
      const hrefs = [
        ...document.querySelectorAll<HTMLLinkElement>(
          'link[rel~="icon"], link[rel="apple-touch-icon"]',
        ),
      ].map((link) => link.href)
      return Promise.all(
        hrefs.map(async (href) => {
          try {
            const response = await fetch(href)
            return {
              href,
              ok: response.ok,
              type: response.headers.get("content-type") ?? "",
            }
          } catch (error) {
            return { href, ok: false, type: String(error) }
          }
        }),
      )
    })
    expect(results, "the page links no icons").not.toHaveLength(0)
    for (const result of results) {
      expect(result.ok, `${result.href} offline: ${result.type}`).toBe(
        true,
      )
      expect(result.type).toMatch(/^image\//)
    }
  })

  test("the origin really is unreachable", async ({ page }) => {
    //THE CONTROL. Without it every assertion above is equally consistent with
    //`setOffline` having done nothing at all, and the suite passes forever.
    const reached = await page.evaluate(async () => {
      try {
        await fetch(`/__uncached-${Math.random()}`, { cache: "no-store" })
        return true
      } catch {
        return false
      }
    })
    expect(
      reached,
      "setOffline did not actually take the network away",
    ).toBe(false)
  })

  for (const file of FILE_FIXTURES) {
    test(`${file} fails rather than falling back to the shell`, async ({
      page,
    }) => {
      //offline, a file link has nothing to fall back TO. Answering it with the
      //shell hands the browser HTML where it asked for a PDF — the same bug as
      //online, just reached through the fallback instead of the route.
      //
      //This is the ssr build's ONLY chance to catch it: `render: "${RENDER}"`.
      const result = await navigateInIsolation(page, file)
      if (!result.ok) return
      expect(
        result.isAppDocument,
        "served the app shell for a file link",
      ).toBe(false)
      expect(result.contentType).not.toContain("text/html")
    })
  }
})
