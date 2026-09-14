import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import {
  bootControlled,
  engineSupportsOffline,
  RENDER,
  workerState,
} from "./sw"

/*
 * An `/assets/` file OUTSIDE the precache still works offline once it has been
 * seen online.
 *
 * The precache glob names `{js,css,ico,png,svg,woff2,json,txt}` (`sw-helpers.ts`),
 * so a `.jpg` the app imports is emitted into `/assets/` and never precached. What
 * keeps it offline is the worker's runtime static route (`sw.static-assets.ts`,
 * cache-first): the online request files it, and the offline one is answered from
 * that cache. Nothing else in this suite loads such a file offline, so a change
 * that took it away passed every spec: an install-time `addRoutes` rule sending
 * `/assets/*` to the precache broke exactly this and the suite stayed green.
 * → `docs/design/rendering.md` §3.3
 */

const ROUTE = "/lab/image"
//the lab photos are plain `?url` / `?adaptv-image` imports, hashed into `/assets/`
const PHOTO = 'img[src*="/assets/lab-photo"]'
//adaptv's <Image> root: it keeps its state in attributes, and it UNMOUNTS the <img>
//on an error, so the root is what is still there to ask
const IMAGE_ROOT = '[data-adaptv="image"]'

/** Where the first lab photo sits among the page's images, and its URL. */
async function findPhoto(page: Page) {
  const img = page.locator(PHOTO).first()
  await img.waitFor({ state: "attached", timeout: 30_000 })
  const index = await img.evaluate(
    (el, root) =>
      [...document.querySelectorAll(root)].indexOf(
        el.closest(root) as Element,
      ),
    IMAGE_ROOT,
  )
  //-1 would make `.nth()` count from the end and ask a different image
  expect(
    index,
    "the lab photo is not inside an <Image> root",
  ).toBeGreaterThanOrEqual(0)
  return { index, src: await img.getAttribute("src") }
}

/** Scroll the image into view (it is `loading="lazy"`) and wait for its outcome. */
async function outcome(page: Page, index: number) {
  const root = page.locator(IMAGE_ROOT).nth(index)
  await root.waitFor({ state: "attached", timeout: 30_000 })
  await root.scrollIntoViewIfNeeded()
  await expect
    .poll(
      () =>
        root.evaluate((el) =>
          el.hasAttribute("data-image-loaded")
            ? "loaded"
            : el.hasAttribute("data-image-error")
              ? "error"
              : "loading",
        ),
      { timeout: 20_000 },
    )
    .not.toBe("loading")
  return root.evaluate((el) =>
    el.hasAttribute("data-image-loaded") ? "loaded" : "error",
  )
}

test.describe(`an /assets/ file outside the precache (render: ${RENDER})`, () => {
  test.skip(
    ({ browserName }) => !engineSupportsOffline(browserName),
    "Playwright WebKit dies with an internal error on any navigation after setOffline — see `sw.ts`.",
  )

  test("renders offline after it was shown online", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000)
    await bootControlled(page)
    await page.goto(ROUTE, { waitUntil: "load" })
    const { index, src } = await findPhoto(page)
    expect(src).toBeTruthy()
    const photo = new URL(src as string, page.url()).pathname
    expect(
      await outcome(page, index),
      `${photo} did not load online`,
    ).toBe("loaded")

    //THE PREMISE. If the glob ever takes `.jpg` in, this stops testing the runtime
    //route and starts testing the precache again, which the other specs already do.
    const { precached } = await workerState(page)
    expect(
      precached.some((url) => new URL(url).pathname === photo),
      `${photo} is precached, so this no longer covers the runtime route`,
    ).toBe(false)

    //cache-first hands the response to the page before its cache write lands, so
    //wait for the file to be in the runtime `static-<build tag>` cache before the
    //network goes; a route that never files it fails here, naming the photo
    await expect
      .poll(
        () =>
          page.evaluate(async (path) => {
            for (const name of await caches.keys()) {
              if (!name.startsWith("static-")) continue
              const cache = await caches.open(name)
              if (await cache.match(path)) return true
            }
            return false
          }, photo),
        {
          message: `the runtime route never cached ${photo}`,
          timeout: 10_000,
        },
      )
      .toBe(true)

    await context.setOffline(true)
    //THE CONTROL: the page's network really is gone
    const reached = await page.evaluate(async () => {
      try {
        await fetch(`/__uncached-${Math.random()}`, { cache: "no-store" })
        return true
      } catch {
        return false
      }
    })
    expect(reached, "setOffline did not take the network away").toBe(false)

    //a fresh tab, so the offline document is not the one the photo rendered in
    const tab = await context.newPage()
    try {
      const answered: string[] = []
      tab.on("response", (response) => {
        if (new URL(response.url()).pathname === photo && response.ok())
          answered.push(
            response.fromServiceWorker() ? "service worker" : "network",
          )
      })
      await tab.goto(ROUTE, { waitUntil: "domcontentloaded" })
      expect(await outcome(tab, index), `${photo} failed offline`).toBe(
        "loaded",
      )
      //and the worker answered it, rather than the HTTP cache behind a worker that
      //let the request through (not seen on this host, where M1 fails offline)
      expect(answered).toContain("service worker")
    } finally {
      await tab.close()
    }
  })
})
