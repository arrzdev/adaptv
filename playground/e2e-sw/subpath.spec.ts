import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { engineReportsServiceWorker, engineSupportsOffline } from "./sw"

/*
 * A static deploy under a subpath, end to end. → `docs/decisions/register.md` B1
 *
 * Built with `--base /app/` and served the way GitHub Pages serves a project
 * site (`subpath-host.ts`): the app owns `/app/`, a miss there is `404.html` with
 * a 404 status, and the origin root belongs to nobody here. That host is an
 * emulation, and its header lists what it leaves out; the ones that could hide a
 * real-host failure are Pages' ten-minute HTTP caching and its case-sensitive
 * file lookup, and none of this was run against github.io.
 *
 * Before this, the SW registration was the only thing that knew about the base.
 * The shell linked its scripts, stylesheet and manifest at the origin root, so
 * the first load 404'd the whole bundle and showed the boot error screen; the
 * router booted from the shell had no basepath, so even a patched shell landed
 * on not-found; and the worker bound `/index.html`, so offline had nothing to
 * serve. Each test below is one of those, observed from the browser, apart from
 * the two that walk what sharing an origin with another site costs.
 */

//Restated from `playwright.sw-subpath.config.ts`, which sets it on the build.
const SUBPATH = "/app/"
//The second site `subpath-host.ts` serves on the same origin.
const NEIGHBOUR = "/other/"

/**
 * The splash is rendered by the shell and unmounts only once the client router
 * is driving, so its absence is the "the app booted" signal — and a boot error
 * screen or a not-found screen are both reachable without it. Hence the heading
 * of the route that was asked for, too.
 */
async function expectRoute(page: Page, heading: string) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
  await expect(
    page.getByRole("heading", { level: 1, name: heading }),
  ).toBeVisible()
}

/** Every same-origin response the page sees, as `status pathname`. */
function recordResponses(page: Page, origin: string): string[] {
  const seen: string[] = []
  page.on("response", (response) => {
    const url = new URL(response.url())
    if (url.origin === origin)
      seen.push(`${response.status()} ${url.pathname}`)
  })
  return seen
}

async function waitForController(page: Page) {
  await page.waitForFunction(
    () => !!navigator.serviceWorker.controller,
    null,
    {
      timeout: 30_000,
    },
  )
}

test.describe(`a spa build under ${SUBPATH}`, () => {
  test("a cold load boots the app and asks for nothing outside the base", async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL as string).origin
    const responses = recordResponses(page, origin)

    await page.goto(SUBPATH)
    await expectRoute(page, "Your tasks")
    await waitForController(page)

    //the root-absolute shell asked for `/assets/*` and `/manifest.json`: every
    //one of those is a 404 here, and each was the whole app not loading
    expect(
      responses.filter((line) => !line.split(" ")[1]?.startsWith(SUBPATH)),
      "requested outside the base",
    ).toEqual([])
    expect(
      responses.filter((line) => !line.startsWith("2")),
      "a request under the base failed",
    ).toEqual([])
  })

  test("registers the worker at the base and scopes it there", async ({
    page,
    baseURL,
  }) => {
    await page.goto(SUBPATH)
    await waitForController(page)
    const registration = await page.evaluate(async () => {
      const current = await navigator.serviceWorker.ready
      return {
        scope: current.scope,
        script: current.active?.scriptURL ?? null,
      }
    })
    const origin = new URL(baseURL as string).origin
    expect(registration).toEqual({
      scope: `${origin}${SUBPATH}`,
      script: `${origin}${SUBPATH}sw.js`,
    })
  })

  test("a deep link boots from the host's 404, then from the worker on reload", async ({
    page,
    browserName,
  }) => {
    //First visit, no worker: the host has no `settings` file and answers with
    //`404.html`. The status is the host's; the app is ours, and must boot.
    const cold = await page.goto(`${SUBPATH}settings`)
    expect(cold?.status()).toBe(404)
    await expectRoute(page, "Settings")
    await waitForController(page)

    //The same link again, now under the worker: it answers from the precached
    //`/app/index.html` — the URL it was built to bind to.
    const warm = await page.reload()
    expect(warm?.status()).toBe(200)
    if (engineReportsServiceWorker(browserName)) {
      expect(warm?.fromServiceWorker()).toBe(true)
    }
    await expectRoute(page, "Settings")
  })

  test("the manifest launches and draws its icons inside the base", async ({
    page,
    baseURL,
  }) => {
    await page.goto(SUBPATH)
    await expectRoute(page, "Your tasks")
    const origin = new URL(baseURL as string).origin
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector<HTMLLinkElement>(
        'link[rel="manifest"]',
      )
      if (!link) return null
      const response = await fetch(link.href)
      const body = await response.json()
      const icons = await Promise.all(
        (body.icons as Array<{ src: string }>).map(async (icon) => {
          const url = new URL(icon.src, link.href)
          return `${(await fetch(url)).status} ${url.pathname}`
        }),
      )
      return {
        href: link.href,
        startUrl: new URL(body.start_url, link.href).href,
        icons,
      }
    })
    expect(manifest?.href).toBe(`${origin}${SUBPATH}manifest.json`)
    //`/` would launch the installed app on somebody else's page
    expect(manifest?.startUrl).toBe(`${origin}${SUBPATH}`)
    expect(manifest?.icons.length).toBeGreaterThan(0)
    for (const icon of manifest?.icons ?? []) {
      expect(icon).toMatch(new RegExp(`^200 ${SUBPATH}`))
    }
  })

  test.describe("next to another site on the same origin", () => {
    //Worker registrations and Cache Storage belong to the origin, not to a
    //scope, so every project site on one github.io origin sees the others' in
    //`getRegistrations()` and `caches.keys()`. Both of adaptv's cleanups walk
    //those lists; each must stop at the base.

    test("the other site's worker survives a visit to the app", async ({
      page,
      context,
      baseURL,
    }) => {
      const origin = new URL(baseURL as string).origin
      await page.goto(NEIGHBOUR)
      const neighbourScope = await page.evaluate(
        async () => (await navigator.serviceWorker.ready).scope,
      )
      expect(neighbourScope).toBe(`${origin}${NEIGHBOUR}`)

      //the foreign-worker cleanup settles before the app's own registration
      //(`service-worker-shell.ts`), so a controller means it has run
      const app = await context.newPage()
      await app.goto(SUBPATH)
      await expectRoute(app, "Your tasks")
      await waitForController(app)

      const scopes = await app.evaluate(async () =>
        (await navigator.serviceWorker.getRegistrations()).map(
          (registration) => registration.scope,
        ),
      )
      expect(scopes.sort()).toEqual(
        [`${origin}${NEIGHBOUR}`, `${origin}${SUBPATH}`].sort(),
      )
    })

    test("the activate sweep takes the app's stale bucket and nobody else's", async ({
      page,
    }) => {
      //Planted before the app's worker exists. `static-<tag>` is what an adaptv
      //user site at the origin root names its bucket, `/other/static-<tag>` a
      //subpath neighbour's, and `/app/static-<tag>` this app's own from a build
      //that is gone: THE CONTROL, which proves the sweep ran at all.
      const planted = {
        root: "static-usersite-0000aa",
        neighbour: `${NEIGHBOUR}static-other-0000aa`,
        stale: `${SUBPATH}static-gone-0000aa`,
      }
      await page.goto(NEIGHBOUR)
      await page.evaluate(async (names) => {
        for (const name of names) await caches.open(name)
      }, Object.values(planted))

      await page.goto(SUBPATH)
      await waitForController(page)
      //`activated` is reported only once every activate `waitUntil` settled,
      //the sweep's included
      await page.waitForFunction(
        () => navigator.serviceWorker.controller?.state === "activated",
        null,
        { timeout: 30_000 },
      )

      const names = await page.evaluate(() => caches.keys())
      expect(names, "the app's own stale bucket").not.toContain(
        planted.stale,
      )
      expect(names).toContain(planted.root)
      expect(names).toContain(planted.neighbour)
    })
  })

  test.describe("offline", () => {
    test.skip(
      ({ browserName }) => !engineSupportsOffline(browserName),
      "Playwright WebKit dies with an internal error on any navigation after setOffline — see `engineSupportsOffline` in sw.ts. iOS offline is walked on the Simulator instead.",
    )

    test("a never-visited route boots from the worker", async ({
      page,
      context,
    }) => {
      await page.goto(SUBPATH)
      await waitForController(page)
      await context.setOffline(true)

      //THE CONTROL: the network really is gone, or the rest proves nothing
      const reached = await page.evaluate(async () => {
        try {
          await fetch(`./__uncached-${Math.random()}`, {
            cache: "no-store",
          })
          return true
        } catch {
          return false
        }
      })
      expect(reached, "setOffline did not take the network away").toBe(
        false,
      )

      //a fresh page, so a failed navigation cannot race the assertion — the
      //registration lives on the context and still controls it
      const tab = await context.newPage()
      await tab.goto(`${SUBPATH}lab`)
      await expectRoute(tab, "Testing")
    })
  })
})
