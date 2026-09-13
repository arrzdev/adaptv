import { readdir, readFile, stat } from "node:fs/promises"
import type { Server } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { extname, join, normalize } from "node:path"
import type { Page, TestInfo } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { deploy, RENDER } from "./sw"

/*
 * The stale-chunk net, against a real second build.
 *
 * A tab is open on build A. Build B deploys and the host no longer serves A's
 * hashed chunks. The tab's next lazy route import asks for one of them and
 * fails, and Vite dispatches `vite:preloadError`. adaptv reloads ONCE, the
 * reload lands on B, and the route renders. Nothing may be drawn over that
 * reload while it is in flight; the offline screen belongs only to a document
 * the reload already produced, when it did not help.
 *
 * What this pins is the part a unit test cannot: Vite's real preload helper, the
 * real router, a real reload. Two screens were measured on top of a recovery
 * that went on to work: "You're offline", because the net was armed twice
 * against one shared guard — and, with that fixed, the router's own "Something
 * went wrong", because the net swallowed the import's error and the router
 * rendered what it got instead.
 *
 * Two deliberate departures from the rest of this suite, both MEASURED:
 *
 * The page is served by a static host this file starts, not by the config's
 * `vite preview`. The preview server renders every document from the server
 * bundle it loaded at startup — in `spa` too — so after a deploy it keeps
 * answering a reload with build A's HTML, pointing at chunks that no longer
 * exist, and nothing can recover. A static host reads the disk, which is what a
 * deploy changes. For the same reason the file runs only against the `spa`
 * build: that is the build a static host serves, and an `ssr` deploy replaces
 * the server too, which no in-test rebuild can do to a running preview.
 *
 * Service workers are blocked. A controlling worker still holds build A's chunks
 * in its precache until the new worker activates — which adaptv holds to the
 * next launch (§3.4) — so with a worker in the path the import succeeds and there
 * is nothing to recover from. The net does not depend on the worker: it is armed
 * for a tab no worker controls, and that is the tab this file drives.
 */

//A lazy route no link on `/` points at, so `defaultPreload: "viewport"` cannot
//have fetched its chunk before the test decides it is gone.
const LAZY_ROUTE = "/lab/share"
const LAZY_CHUNK = /\/assets\/share\.page-[^/]+\.js$/
//The second deploy's route: nothing on the share page links to it.
const SECOND_LAZY_ROUTE = "/lab/device"
const SECOND_LAZY_CHUNK = /\/assets\/device\.page-[^/]+\.js$/

/**
 * adaptv's recovery window and guard key (`src/shell/preload-error-recovery.ts`).
 * Mirrored rather than imported: the spec runs in Node and the module is the
 * app's. Lengthen the window there without updating it here and the two-deploy
 * test fails on its second stale chunk, which is the signal to come back.
 */
const RECOVERY_WINDOW_MS = 30_000
const RECOVERY_GUARD_KEY = "adaptv:preload-error-reload"

test.use({ serviceWorkers: "block" })

test.describe(`stale chunk (render: ${RENDER})`, () => {
  test.skip(
    RENDER !== "spa",
    "needs a host that serves the deploy from disk — the preview server keeps rendering the build it started with, see above",
  )

  let host: StaticHost

  test.beforeAll(async () => {
    host = await startStaticHost(
      //`rootDir` is the resolved testDir, `playground/e2e-sw` — see `deploy()`
      join(test.info().config.rootDir, "..", "apps/frontend/dist/client"),
    )
  })

  test.afterAll(async () => {
    await host?.close()
    //Put back the build the config's preview server started with. That server
    //indexes the output directory once, at startup, so every chunk these deploys
    //renamed is a 404 to it: the worker's precache fails to install, and every
    //later spec waiting on a controller times out. An empty tag derives it from
    //the bundle, as the server's own build did, so the bytes come back identical.
    test.setTimeout(300_000)
    deploy("", test.info().config.rootDir)
  })

  for (const missing of ["404", "index"] as const) {
    test(`a pruned route chunk reloads onto the new build with nothing drawn over the reload (missing file: ${missing})`, async ({
      page,
      browserName,
    }, testInfo) => {
      //full production builds run inside this test
      test.setTimeout(300_000)
      host.missing = missing
      const probe = await installProbe(page)

      await bootOnIndex(page, host)
      const buildA = await entryScripts(page)
      await deployRenamingChunk(host, testInfo, LAZY_CHUNK)

      const since = probe.mark()
      await inPage(page, "navigate", LAZY_ROUTE)
      await probe.waitForDocuments(since, 1)
      await page.waitForLoadState("load")
      //The host answers a deep link with the index, whose markup is `/`, so the
      //route's heading can only have been rendered by build B's client.
      const rendered = await page
        .getByRole("heading", { name: "Share", level: 1 })
        .waitFor({ timeout: 15_000 })
        .then(
          () => true,
          () => false,
        )
      const buildB = await entryScripts(page)
      const events = probe.report(testInfo.project.name, since, {
        missing,
        buildChanged: JSON.stringify(buildA) !== JSON.stringify(buildB),
        rendered,
      })
      const reload = events.find((entry) => entry.kind === "document")
      const beforeReload = events.filter(
        (entry) => reload === undefined || entry.at < reload.at,
      )

      expect(
        beforeReload.filter((entry) => entry.kind === "preload-error")
          .length,
        "no `vite:preloadError` — the import did not fail, so the net was never exercised",
      ).toBeGreaterThan(0)
      expect(
        beforeReload.filter((entry) => entry.kind === "offline-shown"),
        "the offline screen was drawn over a reload that went on to recover",
      ).toEqual([])
      expect(
        events.filter((entry) => entry.kind === "document").length,
        "a second reload — the one-reload guard did not hold",
      ).toBe(1)
      expect(
        buildB,
        "the reload landed on the build it was already running — the deploy did not replace the chunks",
      ).not.toEqual(buildA)
      expect(rendered, "the route never rendered after the reload").toBe(
        true,
      )
      await expect(page).toHaveURL(`${host.origin}${LAZY_ROUTE}`)

      const drawnOverReload = beforeReload
        .filter((entry) => entry.kind === "screen")
        .map((entry) => entry.detail)
      if (missing === "index" && browserName === "webkit") {
        //MEASURED, and pinned rather than skipped. Behind a host that answers a
        //missing chunk with the index, WebKit rejects the import with "'text/html'
        //is not a valid JavaScript MIME type." The router holds a failed route
        //import as a reload in progress only for the wordings it recognises as a
        //missing module, so it hands this one to the app's error boundary, which
        //sits over the reload for its round trip. The net cannot hold the page
        //still from an event — see `installPreloadErrorRecovery`. Should this
        //start failing because nothing is drawn, the gap closed: fold it into the
        //branch below.
        expect(
          drawnOverReload,
          "WebKit behind a rewrite host no longer draws the app's error screen over the reload",
        ).toEqual([expect.stringContaining("Something went wrong")])
      } else {
        expect(
          drawnOverReload,
          "the page changed under a reload that was already in flight — whatever it drew is a failure screen over a recovery",
        ).toEqual([])
      }
    })
  }

  test("a tab that already recovered once recovers from the next deploy too", async ({
    page,
  }, testInfo) => {
    //What every fresh-context test above cannot see: the SECOND recovery in one
    //tab session. Two things used to be spent by the first one and never given
    //back. adaptv's own guard read any later stale chunk as "the reload already
    //failed" and drew the offline screen with no reload at all, though a reload
    //would have fixed it. And the router's own reload net keys its loop guard on
    //the error's message, which in WebKit carries no URL — one key for the
    //whole session — so the second recovery reloaded under its error screen.
    //
    //404, not the rewrite host: that is the wording the router holds as a reload
    //in progress. Behind the rewrite host WebKit draws its error screen over
    //every reload, first or later (the test above), so there is nothing clean
    //left for a second deploy to break.
    test.setTimeout(480_000)
    host.missing = "404"
    const probe = await installProbe(page)

    await bootOnIndex(page, host)
    const served = new Set<string>()
    await deployRenamingChunk(host, testInfo, LAZY_CHUNK, served)
    const first = await recoverOnto(page, host, probe, testInfo, {
      route: LAZY_ROUTE,
      heading: "Share",
    })

    //the second route's chunk must still be unfetched in the document the first
    //reload produced, or its import cannot fail
    expect(
      await page.evaluate(
        (source) =>
          performance
            .getEntriesByType("resource")
            .filter((entry) => new RegExp(source).test(entry.name)).length,
        SECOND_LAZY_CHUNK.source,
      ),
      "the second route's chunk was already loaded — its import cannot fail",
    ).toBe(0)
    await deployRenamingChunk(host, testInfo, SECOND_LAZY_CHUNK, served)
    //A stale chunk this soon after a recovery reload is read as the reload not
    //having helped — that is adaptv's loop guard — so the second one arrives
    //after the window, as a later deploy does.
    await waitPastRecoveryWindow(page)

    const second = await recoverOnto(page, host, probe, testInfo, {
      route: SECOND_LAZY_ROUTE,
      heading: "Device",
    })
    expect(
      second.build,
      "the second reload landed on the build the first one brought in",
    ).not.toEqual(first.build)
  })

  test("a chunk the reload did not bring back shows the offline screen, and reloads no further", async ({
    page,
  }, testInfo) => {
    //THE CONTROL for the test above. "Nothing was drawn" is equally consistent
    //with a probe that cannot see a screen, or a net that never decides anything
    //is unrecoverable. This is the bad deploy: the chunk is missing from every
    //build the host has, so the one reload cannot bring it back, and the
    //document that reload produced must say so.
    //
    //Driven by a PRELOAD — the `viewport` preload a link scrolling into view
    //makes — not a navigation. A navigation commits the URL first, so its reload
    //lands on the route and imports the chunk while that document is still
    //booting, before the shell has mounted the net (measured: ~70 ms in). That
    //gap is pinned by the next test; this control needs the case the net is
    //armed for.
    const probe = await installProbe(page)
    await page.route(LAZY_CHUNK, (route) => route.fulfill({ status: 404 }))

    await bootOnIndex(page, host)

    const since = probe.mark()
    await inPage(page, "preload", LAZY_ROUTE)
    await probe.waitForDocuments(since, 1)
    await page.waitForLoadState("load")
    await routerIdle(page)
    await inPage(page, "preload", LAZY_ROUTE)
    const offlineVisible = await page
      .locator('[data-adaptv="offline"]')
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(
        () => true,
        () => false,
      )
    //Long enough for a second reload to have committed, had the guard not held:
    //every document this host serves takes one round trip to arrive.
    await page.waitForTimeout(DOCUMENT_LATENCY_MS * 3)
    const events = probe.report(testInfo.project.name, since, {
      offlineVisible,
    })
    const reload = events.find((entry) => entry.kind === "document")

    expect(
      offlineVisible,
      "a chunk no reload can bring back never reached the offline screen",
    ).toBe(true)
    expect(
      events.filter((entry) => entry.kind === "document").length,
      "reloaded more than once — a genuinely missing chunk became a loop",
    ).toBe(1)
    expect(
      events.filter(
        (entry) =>
          entry.kind === "offline-shown" &&
          (reload === undefined || entry.at < reload.at),
      ),
      "the offline screen appeared in the document whose reload was still in flight",
    ).toEqual([])
  })

  test("a tapped link to a chunk that stays missing reloads once, then holds on the router's error screen", async ({
    page,
  }, testInfo) => {
    //The gap the control above steps around, pinned so it cannot become a loop.
    //Two nets act on a navigation's failure: adaptv's, and the router's own,
    //whose one-shot key adaptv clears whenever it reloads. The reload lands on
    //the route and imports the chunk while it boots, before the shell has armed
    //adaptv's net, so only the router's key stands between that document and a
    //second reload. It must still be set — by the router, in the document that
    //reloaded, after adaptv cleared it.
    const probe = await installProbe(page)
    await page.route(LAZY_CHUNK, (route) => route.fulfill({ status: 404 }))

    await bootOnIndex(page, host)

    const since = probe.mark()
    await inPage(page, "navigate", LAZY_ROUTE)
    await probe.waitForDocuments(since, 1)
    await page.waitForLoadState("load")
    const errorVisible = await page
      .getByText("Something went wrong")
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(
        () => true,
        () => false,
      )
    //several round trips, each of which a further reload would have committed in
    await page.waitForTimeout(DOCUMENT_LATENCY_MS * 10)
    const events = probe.report(testInfo.project.name, since, {
      errorVisible,
    })

    expect(
      events.filter((entry) => entry.kind === "document").length,
      "reloaded more than once — a genuinely missing chunk became a loop",
    ).toBe(1)
    //MEASURED: the router's screen, never the offline one, because the failure
    //beats the net. Should the offline screen show here instead, the gap closed:
    //the §3.1.2 promise now holds for a navigation too.
    expect(errorVisible, "the router's error screen never settled").toBe(
      true,
    )
    expect(
      await page.locator('[data-adaptv="offline"]').count(),
      "the offline screen showed for a navigation — the boot-time gap closed, update rendering.md §3.4",
    ).toBe(0)
  })
})

type ProbeEntry = { kind: string; at: number; detail: string }

/**
 * What the page did, reported from inside it through a binding that outlives
 * every document the test sees: a reload destroys the page's own memory, and
 * what is being measured sits right before one.
 */
async function installProbe(page: Page) {
  const entries: ProbeEntry[] = []
  await page.exposeBinding(
    "__staleChunkProbe",
    (_source, kind: string, detail: string) => {
      entries.push({ kind, at: Date.now(), detail })
    },
  )
  page.on("pageerror", (error) => {
    entries.push({
      kind: "page-error",
      at: Date.now(),
      detail: error.message,
    })
  })
  await page.addInitScript(() => {
    const report = (
      window as unknown as {
        __staleChunkProbe: (kind: string, detail: string) => void
      }
    ).__staleChunkProbe
    report("document", location.pathname)

    const offlineMounted = () =>
      !!document.querySelector('[data-adaptv="offline"]')
    const visibleText = () =>
      (document.body?.innerText ?? "").replace(/\s+/g, " ").trim()

    //What the page shows is recorded from this document's first failed import
    //on: anything that changes after it was drawn over the failure.
    let failedAt: string | null = null
    window.addEventListener("vite:preloadError", (event) => {
      const payload = (event as Event & { payload?: unknown }).payload
      report("preload-error", String(payload))
      failedAt ??= visibleText()
    })

    //`document`, not `document.documentElement`: the element does not exist
    //yet when an init script runs, and observing it throws — silently killing
    //the probe, which then reads exactly like "nothing was ever drawn".
    let offlineSeen = false
    new MutationObserver(() => {
      if (failedAt !== null) {
        const text = visibleText()
        if (text !== failedAt) {
          report("screen", text.slice(0, 120))
          failedAt = text
        }
      }
      const offline = offlineMounted()
      if (offline === offlineSeen) return
      offlineSeen = offline
      report(offline ? "offline-shown" : "offline-hidden", "")
      //a DOM node is not a pixel: a second animation frame with the screen
      //still mounted means the first one was presented with it on it
      if (offline) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (offlineMounted()) report("offline-painted", "")
          }),
        )
      }
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  })

  const since = (from: number) =>
    entries
      .filter((entry) => entry.at >= from)
      .map((entry) => ({ ...entry, at: entry.at - from }))

  return {
    mark: () => Date.now(),
    waitForDocuments: (from: number, count: number) =>
      expect
        .poll(
          () =>
            since(from).filter((entry) => entry.kind === "document")
              .length,
          {
            timeout: 30_000,
            message: "the page never reloaded after the failed import",
          },
        )
        .toBeGreaterThanOrEqual(count),
    /**
     * Printed before any assertion, pass or fail: how long a screen sat on top
     * of the in-flight reload is the number this file holds at "never", and a
     * failing run is exactly when it is worth reading.
     */
    report: (project: string, from: number, extra: object) => {
      const events = since(from)
      const reload = events.find((entry) => entry.kind === "document")
      const drawnOver = events.find(
        (entry) =>
          (entry.kind === "offline-shown" || entry.kind === "screen") &&
          reload !== undefined &&
          entry.at < reload.at,
      )
      console.log(
        `[stale-chunk ${project}] ${JSON.stringify({
          drawnOverReloadMs:
            drawnOver && reload ? reload.at - drawnOver.at : null,
          ...extra,
          events,
        })}`,
      )
      return events
    },
  }
}

/** Boot the app on `/` and prove the lazy route's chunk is not loaded yet. */
async function bootOnIndex(page: Page, host: StaticHost) {
  const lazyChunkRequests: string[] = []
  const onRequest = (request: { url: () => string }) => {
    if (LAZY_CHUNK.test(new URL(request.url()).pathname)) {
      lazyChunkRequests.push(request.url())
    }
  }
  page.on("request", onRequest)
  await page.goto(`${host.origin}/`, { waitUntil: "load" })
  await routerIdle(page)
  page.off("request", onRequest)
  expect(
    lazyChunkRequests,
    "the lazy route's chunk was fetched at boot — its import cannot fail later, so this run cannot reach the net",
  ).toEqual([])
}

/** The client router is up and has nothing in flight. */
async function routerIdle(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __TSR_ROUTER__?: { state: { status: string } }
            }
          ).__TSR_ROUTER__?.state.status ?? null,
      ),
    )
    .toBe("idle")
}

/**
 * Ask the app's router for a route, as a link would: `navigate` as a tap does,
 * `preload` as one scrolling into view does. Not awaited inside the page — the
 * route's import is what fails, and the reload that follows destroys this
 * execution context.
 */
async function inPage(
  page: Page,
  action: "navigate" | "preload",
  to: string,
) {
  await page.evaluate(
    ([kind, path]) => {
      const router = (
        window as unknown as {
          __TSR_ROUTER__: {
            navigate: (options: { to: string }) => Promise<unknown>
            preloadRoute: (options: { to: string }) => Promise<unknown>
          }
        }
      ).__TSR_ROUTER__
      const pending =
        kind === "navigate"
          ? router.navigate({ to: path })
          : router.preloadRoute({ to: path })
      void pending.catch(() => {})
    },
    [action, to] as const,
  )
}

/**
 * Which build a document is running: every hashed script its head references —
 * `<script src>`, module preloads and inline `import()`s alike, since which of
 * those carries the entry is the router's business, not this test's.
 */
function entryScripts(page: Page) {
  return page.evaluate(() =>
    [
      ...new Set(document.head.innerHTML.match(/\/assets\/[\w.-]+\.js/g)),
    ].sort(),
  )
}

/**
 * The build shapes a deploy rotates through: the same sources, different bytes,
 * so every hashed chunk name changes.
 */
const BUILD_SHAPES: readonly (readonly string[])[] = [
  ["--minify", "false"],
  ["--minify", "terser"],
  [],
]
let lastShape = -1

/**
 * Deploy the next build. Every hashed chunk name changes and the build empties
 * the output directory of the previous one's. That is the deploy the net exists
 * for — a host that no longer serves the previous build.
 *
 * The route's chunk must come out under a name this test's host has NEVER
 * served, not merely one different from what is on disk: a tab that already
 * asked for a pruned name keeps the host's 404 for it, and a later build that
 * happens to bring the same bytes back fails on that remembered answer —
 * MEASURED in WebKit, where a third build back in the first build's shape could
 * not load a shared chunk the first recovery had 404'd. A real deploy never
 * resurrects a pruned hash, so this one must not either. `served` is every asset
 * name the host has had on disk since the test started.
 */
async function deployRenamingChunk(
  host: StaticHost,
  testInfo: TestInfo,
  chunk: RegExp,
  served: Set<string> = new Set(),
) {
  for (const name of await readdir(join(host.root, "assets")))
    served.add(name)
  const tag = `e2e-stale-chunk-${testInfo.project.name}-${Date.now()}`
  for (let attempt = 0; attempt < BUILD_SHAPES.length; attempt += 1) {
    lastShape = (lastShape + 1) % BUILD_SHAPES.length
    deploy(tag, testInfo.config.rootDir, BUILD_SHAPES[lastShape])
    const renamed = await chunkOnDisk(host.root, chunk)
    if (renamed !== null && !served.has(renamed)) {
      for (const name of await readdir(join(host.root, "assets"))) {
        served.add(name)
      }
      return
    }
  }
  throw new Error(
    "no build shape renamed the lazy chunk to a name the host never served — nothing on the host is stale",
  )
}

/** A route's chunk as the host would serve it right now. */
async function chunkOnDisk(root: string, chunk: RegExp) {
  const assets = await readdir(join(root, "assets"))
  return assets.find((name) => chunk.test(`/assets/${name}`)) ?? null
}

/**
 * Navigate to a route whose chunk the deploy pruned, and hold the recovery to
 * the clean shape: a preload error, exactly one reload, nothing drawn over it,
 * the offline screen never mounted, and the route rendered by the new build.
 */
async function recoverOnto(
  page: Page,
  host: StaticHost,
  probe: Awaited<ReturnType<typeof installProbe>>,
  testInfo: TestInfo,
  { route, heading }: { route: string; heading: string },
) {
  const buildBefore = await entryScripts(page)
  const since = probe.mark()
  await inPage(page, "navigate", route)
  //not thrown from here: a recovery that never reloads is the failure worth
  //reading, so the report prints first and the assertions below name it
  await probe.waitForDocuments(since, 1).catch(() => {})
  await page.waitForLoadState("load")
  const rendered = await page
    .getByRole("heading", { name: heading, level: 1 })
    .waitFor({ timeout: 15_000 })
    .then(
      () => true,
      () => false,
    )
  const buildAfter = await entryScripts(page)
  const events = probe.report(testInfo.project.name, since, {
    route,
    rendered,
    buildChanged:
      JSON.stringify(buildBefore) !== JSON.stringify(buildAfter),
  })
  const reload = events.find((entry) => entry.kind === "document")
  const beforeReload = events.filter(
    (entry) => reload === undefined || entry.at < reload.at,
  )

  expect(
    beforeReload.filter((entry) => entry.kind === "preload-error").length,
    `${route}: no \`vite:preloadError\` — the import did not fail, so the net was never exercised`,
  ).toBeGreaterThan(0)
  expect(
    events.filter((entry) => entry.kind === "offline-shown"),
    `${route}: the offline screen was shown for a stale chunk a reload could fix`,
  ).toEqual([])
  expect(
    events.filter((entry) => entry.kind === "document").length,
    `${route}: not exactly one reload`,
  ).toBe(1)
  expect(
    beforeReload
      .filter((entry) => entry.kind === "screen")
      .map((entry) => entry.detail),
    `${route}: the page changed under a reload that was already in flight`,
  ).toEqual([])
  expect(
    buildAfter,
    `${route}: the reload did not land on a new build`,
  ).not.toEqual(buildBefore)
  expect(
    rendered,
    `${route}: the route never rendered after the reload`,
  ).toBe(true)
  await expect(page).toHaveURL(`${host.origin}${route}`)
  return { build: buildAfter }
}

/**
 * Hold until adaptv's last recovery stamp is older than its window, read off
 * the page's own clock. The deploy between the two recoveries is a production
 * build, so most of the window has usually gone by already.
 */
async function waitPastRecoveryWindow(page: Page) {
  const remaining = await page.evaluate(
    ([key, windowMs]) => {
      const stamp = Number(sessionStorage.getItem(key))
      return stamp + windowMs - Date.now()
    },
    [RECOVERY_GUARD_KEY, RECOVERY_WINDOW_MS] as const,
  )
  console.log(
    `[stale-chunk] ${Math.max(0, remaining)} ms left of the recovery window after the deploy`,
  )
  if (remaining > 0) await page.waitForTimeout(remaining + 1_000)
}

type StaticHost = {
  origin: string
  root: string
  /**
   * What a request for a file that does not exist gets. `"index"` is the
   * `_redirects` the `spa` build emits (`/* /index.html 200`), applied to every
   * path; `"404"` is a host that rewrites only extensionless paths, the shape of
   * S3 behind a CDN or nginx's `try_files $uri =404` for assets. A pruned chunk
   * fails either way, but the two fail with different errors.
   */
  missing: "404" | "index"
  close: () => Promise<void>
}

/**
 * Every document answer waits this long — a modest mobile round trip.
 *
 * On localhost a reload commits within a few milliseconds, which is barely a
 * window at all. A real host takes a round trip, and the old document keeps
 * painting for all of it — which is exactly how long anything drawn over an
 * in-flight reload stays on screen.
 */
const DOCUMENT_LATENCY_MS = 300

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
}

/**
 * A static host over the `spa` build output: a file that exists is served, a
 * deep link gets the index, and a missing file gets whatever `missing` says.
 * Read from disk on every request, so a deploy is live the moment it lands.
 *
 * `E2E_SW_STATIC_PORT` pins the port for a machine that leases them; left unset,
 * the OS picks a free one and nothing can collide.
 */
async function startStaticHost(root: string): Promise<StaticHost> {
  const host: StaticHost = {
    origin: "",
    root,
    missing: "index",
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
  const existingFile = async (pathname: string) => {
    const file = normalize(join(root, decodeURIComponent(pathname)))
    if (!file.startsWith(root)) return null
    const found = await stat(file).catch(() => null)
    return found?.isFile() ? file : null
  }
  const server: Server = createServer((request, response) => {
    void (async () => {
      const { pathname } = new URL(request.url ?? "/", "http://host")
      const found = await existingFile(pathname)
      if (!found && extname(pathname) !== "" && host.missing === "404") {
        response.writeHead(404).end()
        return
      }
      const file = found ?? join(root, "index.html")
      if (extname(file) === ".html") {
        await new Promise((resolve) =>
          setTimeout(resolve, DOCUMENT_LATENCY_MS),
        )
      }
      const body = await readFile(file)
      response.writeHead(200, {
        "content-type":
          CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-cache",
      })
      response.end(body)
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })
  await new Promise<void>((resolve) =>
    server.listen(Number(process.env.E2E_SW_STATIC_PORT ?? 0), resolve),
  )
  const { port } = server.address() as AddressInfo
  host.origin = `http://localhost:${port}`
  return host
}
