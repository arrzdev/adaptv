import type { Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * App state — the web half of the foreground/background signal, in real engines.
 *
 * `src/capabilities/app-state.ts` binds `visibilitychange` (edge-triggered) and
 * `pageshow` with `persisted` (a bfcache restore, forced through because its pause
 * may have been missed). The unit test drives both with synthetic events, so it
 * can only ever check the ORDER it was written with. What only a browser can say
 * is the order an engine really dispatches, and on Chromium that order made one
 * departure and one restore report TWO resumes: `visibilitychange → visible`
 * delivered the resume, then `pageshow persisted` forced it a second time.
 *
 * Measured on this harness (Playwright 1.61, 2026-09-13), per engine:
 *
 *   Chromium 149, leaving:  pagehide(persisted) → visibilitychange(hidden)
 *                           → freeze
 *   Chromium 149, restore:  resume → visibilitychange(visible)
 *                           → pageshow(persisted)
 *   WebKit, leaving:        pagehide(persisted: false) → visibilitychange(hidden)
 *   WebKit, back:           a fresh document — never a restore
 *
 * Four things had to be true before any of that could be observed, and each one
 * silently turns the restore into a reload that would pass every assertion:
 *
 *   1. Playwright launches Chromium with `--disable-back-forward-cache`; it is
 *      dropped below for this file.
 *   2. The default headless shell cannot restore at all — CDP's
 *      `backForwardCacheNotUsed` names `BackForwardCacheDisabledForDelegate`, even
 *      for a static text file. The full Chromium build (the `chromium` channel, new
 *      headless) restores, so this file runs on it.
 *   3. The dev server's HMR WebSocket blocks the cache (`notRestoredReasons`:
 *      `websocket`). A built app opens no such socket, so the bfcache test stubs
 *      that one socket, and only that one, before the app boots.
 *   4. `page.goBack()` waits for `load`, which a restore never fires — it waits on
 *      `commit` and then on the restore itself.
 *
 * Every restore test asserts its premise — the SAME document came back, with
 * `pageshow.persisted` — so a harness that stops restoring fails here by name
 * instead of passing on a reload.
 *
 * What headless cannot do honestly, measured on both engines: flip visibility on
 * its own. A second page with `bringToFront`, a same-window CDP target with
 * `Target.activateTarget`, and minimising the window all leave the first page
 * `visible`, and CDP `Page.setWebLifecycleState: frozen` on a visible page
 * dispatches no `freeze` at all. So the tab-switch test attempts the real
 * mechanism and skips, with what it saw, when the engine does not move — never a
 * dispatched `Event` presented as the browser's — and WebKit's restore skips the
 * same way. The bfcache round trip is the one real hidden → frozen → resumed →
 * visible cycle headless offers, and it is asserted in full. A plain tab switch,
 * iOS Safari's bfcache and a WebView resume stay device walks (the lab brief).
 */

test.use({
  launchOptions: {
    ignoreDefaultArgs: ["--disable-back-forward-cache"],
  },
  channel: [
    async ({ browserName }, use) => {
      await use(browserName === "chromium" ? "chromium" : undefined)
    },
    { scope: "worker" },
  ],
})

type Recorded = {
  type: string
  vis: DocumentVisibilityState
  path: string
  persisted?: boolean
}

/*
 * The engine's own lifecycle events, in dispatch order, for every document the
 * tab loads. sessionStorage outlives a navigation, so the departure is still there
 * to read after the return. Capture phase, installed before any app script, so the
 * record is the order the browser dispatched — not the order the app saw.
 */
function recordLifecycle() {
  const push = (type: string, extra: { persisted?: boolean } = {}) => {
    const list = JSON.parse(sessionStorage.getItem("lifecycle") ?? "[]")
    list.push({
      type,
      vis: document.visibilityState,
      path: location.pathname,
      ...extra,
    })
    sessionStorage.setItem("lifecycle", JSON.stringify(list))
  }
  push("document")
  for (const type of ["visibilitychange", "freeze", "resume"]) {
    document.addEventListener(type, () => push(type), true)
  }
  for (const type of ["pagehide", "pageshow"] as const) {
    window.addEventListener(
      type,
      (event) => push(type, { persisted: event.persisted }),
      true,
    )
  }
}

/*
 * The dev server's HMR socket, and only it (matched by its `vite-hmr` subprotocol),
 * becomes an inert object that never opens. Chromium will not cache a page holding
 * an open WebSocket, and a production build never opens this one — so without the
 * stub the test measures the dev loop, not the app. Any other socket is untouched.
 */
function stubDevServerSocket() {
  const Native = window.WebSocket
  function DevAwareWebSocket(
    url: string | URL,
    protocols?: string | string[],
  ) {
    if (([] as string[]).concat(protocols ?? []).includes("vite-hmr")) {
      return Object.assign(new EventTarget(), {
        url: String(url),
        readyState: 0,
        send() {},
        close() {},
      })
    }
    return new Native(url, protocols)
  }
  Object.assign(DevAwareWebSocket, {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  })
  window.WebSocket = DevAwareWebSocket as unknown as typeof WebSocket
}

const recorded = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(
        sessionStorage.getItem("lifecycle") ?? "[]",
      ) as Recorded[],
  )

const markDocument = (page: Page) =>
  page.evaluate(() => {
    const mark = crypto.randomUUID()
    ;(window as { __appStateMark?: string }).__appStateMark = mark
    return mark
  })

const readMark = (page: Page) =>
  page.evaluate(
    () => (window as { __appStateMark?: string }).__appStateMark ?? null,
  )

/** The value cell of a lab row, found by its exact label. */
const rowValue = (page: Page, label: string): Locator =>
  page
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::span")

/**
 * Both counters plus the raw accessor log, once React has painted whatever the
 * last event scheduled. Waiting for a counter to reach a value would pass on the
 * way to a double; this lets React's scheduled task run and two frames paint,
 * then reads once.
 */
async function settledCounts(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        setTimeout(() =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
      ),
  )
  const log = await page.locator("[data-lab-log] li").allInnerTexts()
  return {
    resumes: await rowValue(page, "useOnResume() calls").innerText(),
    pauses: await rowValue(page, "useOnPause() calls").innerText(),
    onResume: log.filter((line) => line.endsWith("· onResume")).length,
    onPause: log.filter((line) => line.endsWith("· onPause")).length,
  }
}

const IDLE = { resumes: "0", pauses: "0", onResume: 0, onPause: 0 }
const ONE_ROUND_TRIP = {
  resumes: "1",
  pauses: "1",
  onResume: 1,
  onPause: 1,
}

test.describe("App state", () => {
  test("a bfcache departure and restore are exactly one pause and one resume", async ({
    page,
    browserName,
  }) => {
    await page.addInitScript(recordLifecycle)
    await page.addInitScript(stubDevServerSocket)
    await page.goto("/lab/app-state")
    await awaitClientHandover(page)
    const mark = await markDocument(page)
    expect(await settledCounts(page)).toEqual(IDLE)

    //a cross-document navigation: an SPA route change never enters the cache
    await page.goto("/robots.txt")
    await page.goBack({ waitUntil: "commit" })
    await expect
      .poll(async () => {
        try {
          const events = await recorded(page)
          //the departure's page records its own exit AFTER the restore, so
          //count from the moment it arrived, not from its last event
          const away = events.findIndex((e) => e.path === "/robots.txt")
          return events
            .slice(away + 1)
            .some(
              (e) => e.type === "pageshow" && e.path === "/lab/app-state",
            )
        } catch {
          return false //the document is still being swapped in
        }
      })
      .toBe(true)

    const events = await recorded(page)
    const restored = (await readMark(page)) === mark
    if (browserName === "webkit" && !restored) {
      test.skip(
        true,
        `WebKit reloaded instead of restoring (no bfcache on this harness): ${JSON.stringify(events)}`,
      )
    }

    //the premise: the same document came back out of the cache, through a real
    //Page Lifecycle freeze and resume — a reload would pass everything below
    expect(restored, JSON.stringify(events)).toBe(true)
    const onApp = events.filter((event) => event.path === "/lab/app-state")
    expect(
      onApp.filter((event) => event.type === "document"),
    ).toHaveLength(1)
    expect(onApp).toContainEqual(
      expect.objectContaining({ type: "pagehide", persisted: true }),
    )
    expect(onApp).toContainEqual(
      expect.objectContaining({ type: "pageshow", persisted: true }),
    )
    if (browserName === "chromium") {
      expect(onApp.map((event) => event.type)).toEqual(
        expect.arrayContaining(["freeze", "resume"]),
      )
    }

    //the claim: one departure, one return — not a resume per event that saw it
    expect(await settledCounts(page), JSON.stringify(events)).toEqual(
      ONE_ROUND_TRIP,
    )
    await expect(rowValue(page, "useAppState()")).toHaveText("active")
    await expect(rowValue(page, "getAppState()")).toHaveText("active")
  })

  test("hiding the page behind another one is one pause, returning is one resume", async ({
    page,
    context,
  }) => {
    await page.addInitScript(recordLifecycle)
    await page.goto("/lab/app-state")
    await awaitClientHandover(page)

    const other = await context.newPage()
    await other.goto("/robots.txt")
    await other.bringToFront()
    const hidden = await page
      .waitForFunction(() => document.visibilityState === "hidden", null, {
        timeout: 2_000,
      })
      .then(() => true)
      .catch(() => false)
    test.skip(
      !hidden,
      "headless keeps a page visible behind another one brought to the front " +
        `(visibilityState stayed "visible"; lifecycle: ${JSON.stringify(await recorded(page))})`,
    )

    await expect(rowValue(page, "useAppState()")).toHaveText("background")
    await page.bringToFront()
    await page.waitForFunction(
      () => document.visibilityState === "visible",
    )
    expect(await settledCounts(page)).toEqual(ONE_ROUND_TRIP)
  })
})
