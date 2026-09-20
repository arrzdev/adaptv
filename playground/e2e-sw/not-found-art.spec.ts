import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { expectImagePainted } from "../e2e/support/painted"
import {
  bootControlled,
  engineSupportsOffline,
  RENDER,
  workerState,
} from "./sw"

/*
 * The 404's art is a file, and it stays out of every page's initial JS.
 *
 * The not-found screen is a STATIC import of the root route — adaptv rewrites the
 * config's `notFoundScreen` thunk into one (`src/vite/root-route-module.ts`), so
 * whatever that screen imports ships in the initial closure of every document.
 * When its mascot was an inline-SVG component that was 130 KB raw / 41 KB brotli
 * on `/`, `/settings` and the shell alike, for a screen most sessions never show.
 * The art is now `illustrations/stressed-mascot.svg`, loaded through an `<img>`,
 * and nothing but this suite would notice it coming back as JS: every page would
 * still render.
 *
 * It lives here rather than in `e2e/` because only a production build has an
 * initial closure to walk; the dev server serves modules one by one. The same
 * build also gives the two things a file can get wrong that inline art could not:
 * a cold 404 that shifts when the image arrives, and a 404 opened offline.
 */

const NOT_FOUND = "/lab/definitely-not-a-route"
const MASCOT = 'img[src*="/assets/stressed-mascot"]'
//the first path of the artwork, as it is written in both the .svg and, when it
//was one, the component's compiled JS. Nothing else in the app draws it
const ART = "M341.53 247.141a217.4 217.4 0 0 1 57.902-33.972"
//a class only the not-found screen writes: the chunk that has it is the chunk the
//screen compiled into
const SCREEN = "w-[min(72vw,18rem,52dvh)]"

//the same static-import scan as the build's own analysis: `import{a as b}from"./x.js"`
//and bare `import"./x.js"`. A dynamic `import("./x.js")` cannot match: the
//specifier must follow `import`/`from` directly, and a `(` is neither
const STATIC_IMPORT =
  /\bimport\s*(?:[\w$]+\s*,?\s*)?(?:\{[^}]*\}|\*\s*as\s*[\w$]+)?\s*(?:from\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g

/** Every chunk a document loads before anything is lazy: its module scripts, its preloads, and their static imports. */
async function initialClosure(request: APIRequestContext, html: string) {
  const roots = [
    ...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g),
    ...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g),
  ].map((match) => new URL(match[1], "http://app/").pathname)
  const chunks = new Map<string, string>()
  const pending = [...roots]
  while (pending.length > 0) {
    const path = pending.pop() as string
    if (chunks.has(path)) continue
    const response = await request.get(path)
    expect(response.ok(), `${path} did not load`).toBe(true)
    const source = await response.text()
    chunks.set(path, source)
    for (const match of source.matchAll(STATIC_IMPORT)) {
      pending.push(new URL(match[1], `http://app${path}`).pathname)
    }
  }
  return chunks
}

/** Resolve once React has attached to the 404 (no splash renders there, so the usual gate is vacuous). */
async function awaitReact(page: Page) {
  await expect
    .poll(
      () =>
        page
          .getByRole("link", { name: /back home/i })
          .evaluate((el) =>
            Object.keys(el).some((key) => key.startsWith("__reactFiber$")),
          ),
      { message: "React never attached to the 404", timeout: 20_000 },
    )
    .toBe(true)
}

test.describe(`the 404's mascot (render: ${RENDER})`, () => {
  test("is a file, and no initial chunk carries the artwork", async ({
    page,
    request,
  }) => {
    const document = await request.get(NOT_FOUND)
    const html = await document.text()
    const chunks = await initialClosure(request, html)
    //THE PREMISE: the walk reached the not-found screen itself — the module that
    //imported the art — and not only the preloads, which alone are several
    //chunks trivially free of it
    expect(chunks.size, "no initial chunks were found").toBeGreaterThan(3)
    expect(
      [...chunks.values()].some((source) => source.includes(SCREEN)),
      "no initial chunk carries the not-found screen, so this walk proves nothing",
    ).toBe(true)

    const carrying = [...chunks]
      .filter(([, source]) => source.includes(ART))
      .map(([path]) => path)
    expect(
      carrying,
      "the mascot's artwork is back in the initial JS: every page downloads it",
    ).toEqual([])
    expect(
      html.includes(ART),
      "the artwork is inline in the document",
    ).toBe(false)

    //and the art is still shipped, as the file the page renders
    await page.goto(NOT_FOUND)
    const mascot = page.locator(MASCOT)
    await expectImagePainted(mascot, "the 404 mascot")
    const file = await request.get(
      (await mascot.getAttribute("src")) as string,
    )
    expect(file.headers()["content-type"]).toContain("image/svg+xml")
    expect(await file.text()).toContain(ART)
  })

  test("a cold 404 hydrates cleanly and holds its layout while the art arrives", async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })
    page.on("pageerror", (error) => errors.push(error.message))

    //hold the file back until the layout has been measured without it — released
    //by the test, not by a timer, which a slow run outlives
    let held = false
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route("**/assets/stressed-mascot-*.svg", async (route) => {
      held = true
      await released
      await route.continue()
    })

    const home = page.getByRole("link", { name: /back home/i })
    const mascot = page.locator(MASCOT)
    let before: Awaited<ReturnType<typeof home.boundingBox>>
    try {
      await page.goto(NOT_FOUND, { waitUntil: "domcontentloaded" })
      await home.waitFor()
      await mascot.waitFor({ state: "attached" })
      //no `document.fonts.ready` here: WebKit holds it until the document's pending
      //loads finish, and the art is one of them, so it would wait for the release.
      //Nor is it needed: the link's box is w-full/max-w-xs by py-4 on a leading-none
      //line, so a font swap cannot move it
      await expect
        .poll(() => held, {
          message: "the art never went through the hold",
        })
        .toBe(true)
      before = await home.boundingBox()
      //THE PREMISE: the art really had not arrived when `before` was read
      expect(
        await mascot.evaluate(
          (el) => (el as HTMLImageElement).naturalWidth,
        ),
        "the mascot had already loaded, so this measured nothing",
      ).toBe(0)
    } finally {
      //a failed premise must not leave the request hanging into the teardown
      release()
    }

    await awaitReact(page)
    await expectImagePainted(mascot, "the cold 404 mascot")
    expect(
      await home.boundingBox(),
      "Back home moved when the art loaded",
    ).toEqual(before)

    //a production build reports a mismatch as a minified recoverable error
    expect(
      errors.filter((text) =>
        /hydrat|Minified React error #4(1[89]|2[0-5])\b/i.test(text),
      ),
      "the server and the client rendered the 404 differently",
    ).toEqual([])
  })

  test("a client-side 404 renders the file the server renders", async ({
    page,
    request,
  }) => {
    test.skip(
      RENDER !== "ssr",
      "an spa build never server-renders the 404",
    )
    //React does not patch a mismatched attribute when it hydrates, and a
    //production build does not even report one, so a server and a client that
    //resolved the file to different URLs would pass the cold load silently
    const html = await (await request.get(NOT_FOUND)).text()
    const serverSrc = html.match(
      /<img[^>]*src="([^"]*\/assets\/stressed-mascot[^"]*)"/,
    )?.[1]
    expect(
      serverSrc,
      "the server-rendered 404 has no mascot <img>",
    ).toBeTruthy()

    await page.goto("/lab/screens")
    await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
      timeout: 20_000,
    })
    await page.getByRole("link", { name: /client navigation/i }).click()
    const mascot = page.locator(MASCOT)
    await expectImagePainted(mascot, "the client-rendered 404 mascot")
    expect(await mascot.getAttribute("src")).toBe(serverSrc)
  })

  test("an offline 404 paints the art from the worker's precache", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(
      !engineSupportsOffline(browserName),
      "Playwright WebKit dies with an internal error on any navigation after setOffline — see `sw.ts`.",
    )
    test.setTimeout(90_000)
    await bootControlled(page)
    await page.goto(NOT_FOUND, { waitUntil: "load" })
    const src = await page.locator(MASCOT).getAttribute("src")
    const art = new URL(src as string, page.url()).pathname

    //THE PREMISE: the file is precached, so offline is the precache's answer
    const { precached } = await workerState(page)
    expect(
      precached.some((url) => new URL(url).pathname === art),
      `${art} is not in the precache`,
    ).toBe(true)

    //empty the HTTP cache, so the offline art can only be the worker's precache
    const cdp = await context.newCDPSession(page)
    await cdp.send("Network.clearBrowserCache")
    await cdp.detach()

    await context.setOffline(true)
    //THE CONTROL: the network really is gone
    const reached = await page.evaluate(async () => {
      try {
        await fetch(`/__uncached-${Math.random()}`, { cache: "no-store" })
        return true
      } catch {
        return false
      }
    })
    expect(reached, "setOffline did not take the network away").toBe(false)

    //a fresh tab and a 404 it has never opened
    const tab = await context.newPage()
    try {
      const answered: string[] = []
      tab.on("response", (response) => {
        if (new URL(response.url()).pathname === art && response.ok())
          answered.push(
            response.fromServiceWorker() ? "service worker" : "network",
          )
      })
      await tab.goto("/lab/another-route-that-is-not-there", {
        waitUntil: "domcontentloaded",
      })
      await expectImagePainted(
        tab.locator(MASCOT),
        "the offline 404 mascot",
      )
      expect(answered).toContain("service worker")
    } finally {
      await tab.close()
    }
  })
})
