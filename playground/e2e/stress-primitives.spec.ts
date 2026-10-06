import type { CDPSession, Page } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import { expect, test } from "./support/reload-guard"

/*
 * Display primitives under load — the stress pass for Image, Collapsible, Skeleton,
 * Spinner, ProgressBar, Text and the nested ScrollView/View pair.
 *
 * The component specs (image.spec.ts, collapsible.spec.ts, spinner.spec.ts, ...)
 * each pin ONE instance doing the right thing at a walking pace. This spec asks what
 * happens at the numbers a real screen reaches and at the speeds a real thumb
 * reaches: a hundred images answered late, missing, or swapped mid-flight; a panel
 * toggled twenty times inside one 200 ms transition; two hundred pulses and turns on
 * screen while the main thread is throttled; a bar written on every frame; ten
 * thousand characters clamped and unclamped; and a horizontal scroller inside a
 * vertical one that must never drag the page sideways.
 *
 * Why `/lab/stress-display` exists: none of the component lab pages can put a
 * hundred of anything on screen, and none lets a spec choose how the network answers.
 * The harness page renders its fields EMPTY and sizes each one by a button, and every
 * image card requests a distinct URL under `/lab/stress-image/<mode>/<nonce>-<i>.png`
 * that THIS file serves through `page.route` — bytes, a 404, or bytes after five
 * seconds — so the premise of every image case is under the test's control.
 *
 * House rules (playground-touch-e2e-patterns): every test asserts its PREMISE before
 * its claim and prints the measured distribution before asserting a bound; waiting is
 * `expect.poll` / `expect(locator)` only — no retries, no warm-ups, no sleeps. The
 * one `setTimeout` below is inside a route handler and IS the premise of "a source
 * that answers after 5 s", not a wait. CDP-only measurements are skipped off chromium.
 */

const IMAGE = '[data-testid="stress-image-field"] [data-adaptv="image"]'
const PANEL = '[data-adaptv="collapsible-panel"]'
const TRIGGER = '[data-adaptv="collapsible-trigger"]'
const SKELETON =
  '[data-testid="stress-skeleton-field"] [data-adaptv="skeleton"]'
const SPINNER =
  '[data-testid="stress-spinner-field"] [data-adaptv="spinner"]'
const ANNOUNCER = '[data-adaptv="spinner-announcer"]'

/**
 * A valid 64 × 48 PNG (one flat colour), the same proportions the cards reserve, so
 * a loaded image neither reveals nor hides a box that the ratio got wrong.
 */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAQ0lEQVR42u3PQQkAAAgEsOtkWjsZygp+hcEKLNXzWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQErhY/mCEeMNto+QAAAABJRU5ErkJggg==",
  "base64",
)

/** The card's reserved proportion: `width={64} height={48}`. */
const CARD_RATIO = 48 / 64

const log = (message: string) =>
  console.log(`[stress-primitives ${test.info().project.name}] ${message}`)

/** Uncaught errors plus console errors and warnings, from the moment it is attached. */
function collectConsole(page: Page): string[] {
  const entries: string[] = []
  page.on("pageerror", (error) =>
    entries.push(`uncaught: ${String(error)}`),
  )
  page.on("console", (message) => {
    const type = message.type()
    if (type === "error" || type === "warning") {
      entries.push(`${type}: ${message.text()}`)
    }
  })
  return entries
}

async function openHarness(page: Page) {
  await page.goto("/lab/stress-display")
  await awaitClientHandover(page)
}

/* =============================================================================
 * Image
 * ============================================================================= */

type ImageServer = {
  /** Requests seen, keyed `<mode>/<nonce>`. */
  requests: Map<string, number>
  /** Requests the browser reported failed (cancelled), keyed the same way. */
  failed: Map<string, number>
  stats: { delayed: number; fulfilled: number; abandoned: number }
  /** Lets every held response go (`hold` only). */
  release: () => void
}

/**
 * Serve the harness's image URLs. `ok` answers with the PNG, `missing` with a 404,
 * `slow` with the PNG after 5 000 ms — the delay is inside the handler because it
 * is the thing under test ("a source that answers late"), and `stats.delayed`
 * counts how many requests actually waited. With `hold`, every response of any
 * mode waits for `release()` instead, so a spec can read the DOM with the bytes
 * provably not yet arrived.
 */
async function serveImages(
  page: Page,
  options: { hold?: boolean } = {},
): Promise<ImageServer> {
  let open = () => {}
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  const requests = new Map<string, number>()
  const failed = new Map<string, number>()
  const stats = { delayed: 0, fulfilled: 0, abandoned: 0 }
  const keyOf = (url: string) => {
    const match = new URL(url).pathname.match(
      /\/lab\/stress-image\/(\w+)\/(\d+)-(\d+)\.png$/,
    )
    return match ? `${match[1]}/${match[2]}` : null
  }
  page.on("requestfailed", (request) => {
    const key = keyOf(request.url())
    if (key) failed.set(key, (failed.get(key) ?? 0) + 1)
  })
  await page.route("**/lab/stress-image/**", async (route) => {
    const key = keyOf(route.request().url())
    if (!key) {
      await route.fulfill({ status: 400 })
      return
    }
    requests.set(key, (requests.get(key) ?? 0) + 1)
    const mode = key.split("/")[0]
    try {
      if (mode === "slow") {
        stats.delayed += 1
        await new Promise((resolve) => setTimeout(resolve, 5_000))
      }
      if (options.hold) await gate
      if (mode === "missing") await route.fulfill({ status: 404 })
      else await route.fulfill({ contentType: "image/png", body: PNG })
      stats.fulfilled += 1
    } catch {
      //the browser dropped the request (a src swap, a page close) before the
      //answer: the engine's abandonment, counted rather than thrown
      stats.abandoned += 1
    }
  })
  return { requests, failed, stats, release: () => open() }
}

type CardSnapshot = {
  loading: boolean
  loaded: boolean
  error: boolean
  unreserved: boolean
  busy: string | null
  width: number
  height: number
  src: string | null
  imgLoading: string | null
  placeholderVisible: boolean
  errorVisible: boolean
}

/** One atomic read of every card in the field: state attributes and the box. */
function snapshotCards(page: Page): Promise<CardSnapshot[]> {
  return page.evaluate((selector) => {
    const visible = (el: Element | null) =>
      el !== null && getComputedStyle(el).visibility !== "hidden"
    return [...document.querySelectorAll(selector)].map((root) => {
      const img = root.querySelector("img")
      const box = root.getBoundingClientRect()
      return {
        loading: root.getAttribute("data-image-loading") !== null,
        loaded: root.getAttribute("data-image-loaded") !== null,
        error: root.getAttribute("data-image-error") !== null,
        unreserved: root.getAttribute("data-image-unreserved") !== null,
        busy: root.getAttribute("aria-busy"),
        width: box.width,
        height: box.height,
        src: img ? img.currentSrc || img.getAttribute("src") : null,
        imgLoading: img ? img.getAttribute("loading") : null,
        placeholderVisible: visible(
          root.querySelector('[data-part="placeholder"]'),
        ),
        errorVisible: visible(root.querySelector('[data-part="error"]')),
      }
    })
  }, IMAGE)
}

const count = (cards: CardSnapshot[], key: keyof CardSnapshot) =>
  cards.filter((card) => card[key] === true).length

const range = (xs: number[]) =>
  `${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)}`

/** Every card's box is 64 × 48 proportioned, to the pixel. */
function expectReservedBoxes(cards: CardSnapshot[], phase: string) {
  const widths = cards.map((c) => c.width)
  const heights = cards.map((c) => c.height)
  const worst = Math.max(
    ...cards.map((c) => Math.abs(c.height - c.width * CARD_RATIO)),
  )
  log(
    `${phase}: ${cards.length} cards, width ${range(widths)}, height ${range(heights)}, worst ratio error ${worst.toFixed(3)}px, unreserved ${count(cards, "unreserved")}`,
  )
  expect(Math.min(...widths), "the cards laid out").toBeGreaterThan(0)
  expect(count(cards, "unreserved")).toBe(0)
  expect(worst).toBeLessThanOrEqual(1)
}

test.describe("Image field", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page)
  })

  test("100 ok: every box is reserved before its bytes and never moves", async ({
    page,
  }) => {
    const server = await serveImages(page, { hold: true })
    await page.getByTestId("stress-image-count-100").click()
    await expect(page.locator(IMAGE)).toHaveCount(100)
    //premise: all hundred requests are in flight and none has been answered
    await expect.poll(() => server.requests.get("ok/0") ?? 0).toBe(100)
    const before = await snapshotCards(page)
    log(
      `ok held: loading ${count(before, "loading")} loaded ${count(before, "loaded")} busy ${before.filter((c) => c.busy === "true").length} placeholder visible ${count(before, "placeholderVisible")}`,
    )
    expect(count(before, "loading")).toBe(100)
    expect(count(before, "loaded")).toBe(0)
    expect(before.every((c) => c.busy === "true")).toBe(true)
    expect(count(before, "placeholderVisible")).toBe(100)
    expectReservedBoxes(before, "ok held")

    server.release()
    await expect(page.locator(`${IMAGE}[data-image-loaded]`)).toHaveCount(
      100,
      { timeout: 10_000 },
    )
    const after = await snapshotCards(page)
    expectReservedBoxes(after, "ok loaded")
    const shifted = after.filter(
      (c, i) => Math.abs(c.height - before[i].height) > 0.5,
    ).length
    log(
      `ok loaded: loading ${count(after, "loading")} placeholder visible ${count(after, "placeholderVisible")} shifted ${shifted} fulfilled ${server.stats.fulfilled}`,
    )
    expect(server.stats.fulfilled).toBe(100)
    expect(shifted).toBe(0)
    expect(count(after, "loading")).toBe(0)
    expect(count(after, "placeholderVisible")).toBe(0)
    expect(after.every((c) => c.busy === null)).toBe(true)
    expect(after.every((c) => c.src?.includes("/ok/0-"))).toBe(true)
  })

  test("100 missing: every card lands on Image.Error with the img gone and the box unchanged", async ({
    page,
  }) => {
    const server = await serveImages(page, { hold: true })
    await page.getByTestId("stress-image-mode-missing").click()
    await page.getByTestId("stress-image-count-100").click()
    await expect(page.locator(IMAGE)).toHaveCount(100)
    await expect
      .poll(() => server.requests.get("missing/0") ?? 0)
      .toBe(100)
    const before = await snapshotCards(page)
    expect(
      count(before, "loading"),
      "premise: held, not yet errored",
    ).toBe(100)
    expectReservedBoxes(before, "missing held")

    server.release()
    await expect(page.locator(`${IMAGE}[data-image-error]`)).toHaveCount(
      100,
      { timeout: 10_000 },
    )
    const after = await snapshotCards(page)
    expectReservedBoxes(after, "missing errored")
    const shifted = after.filter(
      (c, i) => Math.abs(c.height - before[i].height) > 0.5,
    ).length
    log(
      `missing errored: error slot visible ${count(after, "errorVisible")} img present ${after.filter((c) => c.src !== null).length} loading ${count(after, "loading")} shifted ${shifted}`,
    )
    expect(shifted).toBe(0)
    expect(count(after, "errorVisible")).toBe(100)
    expect(count(after, "loading")).toBe(0)
    expect(count(after, "loaded")).toBe(0)
    expect(after.every((c) => c.busy === null)).toBe(true)
    await expect(page.locator(`${IMAGE} img`)).toHaveCount(0)
    await expect(
      page.locator(`${IMAGE} [data-part="error"]`).first(),
    ).toBeVisible()
  })

  test("100 slow: busy, loading and reserved for five seconds, then all loaded", async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const server = await serveImages(page)
    await page.getByTestId("stress-image-mode-slow").click()
    const pressed = Date.now()
    await page.getByTestId("stress-image-count-100").click()
    await expect(page.locator(IMAGE)).toHaveCount(100)
    await expect.poll(() => server.requests.get("slow/0") ?? 0).toBe(100)
    const waiting = await snapshotCards(page)
    log(
      `slow waiting: loading ${count(waiting, "loading")} busy ${waiting.filter((c) => c.busy === "true").length} placeholder visible ${count(waiting, "placeholderVisible")} delayed ${server.stats.delayed}`,
    )
    expect(server.stats.delayed).toBe(100)
    expect(count(waiting, "loading")).toBe(100)
    expect(waiting.every((c) => c.busy === "true")).toBe(true)
    expect(count(waiting, "placeholderVisible")).toBe(100)
    expectReservedBoxes(waiting, "slow waiting")

    await expect(page.locator(`${IMAGE}[data-image-loaded]`)).toHaveCount(
      100,
      { timeout: 15_000 },
    )
    const answered = Date.now() - pressed
    const loaded = await snapshotCards(page)
    log(
      `slow loaded after ${answered}ms: loading ${count(loaded, "loading")} placeholder visible ${count(loaded, "placeholderVisible")}`,
    )
    //premise: the source really answered late, so the waiting reads were of a
    //field with no bytes
    expect(answered).toBeGreaterThanOrEqual(4_500)
    expectReservedBoxes(loaded, "slow loaded")
    expect(count(loaded, "loading")).toBe(0)
    expect(count(loaded, "placeholderVisible")).toBe(0)
  })

  test("src swapped mid-load: the second batch wins and no card is left loading a stale src", async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const server = await serveImages(page)
    await page.getByTestId("stress-image-mode-slow").click()
    await page.getByTestId("stress-image-count-100").click()
    await page.getByTestId("stress-image-swap").click()
    await expect(page.locator(IMAGE)).toHaveCount(100)
    //premise: both batches were requested — the first was in flight when the swap landed
    await expect.poll(() => server.requests.get("slow/1") ?? 0).toBe(100)
    const firstBatch = server.requests.get("slow/0") ?? 0
    log(`swap: requests per nonce ${JSON.stringify([...server.requests])}`)
    expect(firstBatch).toBeGreaterThan(0)
    const mid = await snapshotCards(page)
    const staleSrc = mid.filter((c) => c.src?.includes("/slow/0-")).length
    log(
      `swap mid-flight: loading ${count(mid, "loading")} loaded ${count(mid, "loaded")} img on nonce 0 ${staleSrc}`,
    )
    expect(count(mid, "loading")).toBe(100)
    expect(staleSrc).toBe(0)

    await expect(page.locator(`${IMAGE}[data-image-loaded]`)).toHaveCount(
      100,
      { timeout: 15_000 },
    )
    const done = await snapshotCards(page)
    const onNewNonce = done.filter((c) =>
      /\/slow\/1-\d+\.png$/.test(c.src ?? ""),
    ).length
    log(
      `swap settled: loaded ${count(done, "loaded")} loading ${count(done, "loading")} img on nonce 1 ${onNewNonce} · failed ${JSON.stringify([...server.failed])} · fulfilled ${server.stats.fulfilled} abandoned ${server.stats.abandoned}`,
    )
    expect(onNewNonce).toBe(100)
    expect(count(done, "loading")).toBe(0)
    expectReservedBoxes(done, "swap settled")
  })

  test("loading flipped lazy and back on a mounted field follows on every img without a re-request", async ({
    page,
  }) => {
    const server = await serveImages(page)
    await page.getByTestId("stress-image-count-100").click()
    await expect(page.locator(`${IMAGE}[data-image-loaded]`)).toHaveCount(
      100,
      { timeout: 10_000 },
    )
    const requestsBefore = server.requests.get("ok/0") ?? 0
    expect(requestsBefore, "premise: one request per card").toBe(100)

    await page.getByTestId("stress-image-loading").click()
    await expect(page.getByTestId("stress-image-loading")).toHaveText(
      /lazy/,
    )
    const lazy = await snapshotCards(page)
    log(
      `flip → lazy: img loading=lazy ${lazy.filter((c) => c.imgLoading === "lazy").length} loaded ${count(lazy, "loaded")} loading ${count(lazy, "loading")} requests ${server.requests.get("ok/0")}`,
    )
    expect(lazy.every((c) => c.imgLoading === "lazy")).toBe(true)
    expect(count(lazy, "loaded")).toBe(100)

    await page.getByTestId("stress-image-loading").click()
    await expect(page.getByTestId("stress-image-loading")).toHaveText(
      /eager/,
    )
    const eager = await snapshotCards(page)
    log(
      `flip → eager: img loading=eager ${eager.filter((c) => c.imgLoading === "eager").length} loaded ${count(eager, "loaded")} requests ${server.requests.get("ok/0")}`,
    )
    expect(eager.every((c) => c.imgLoading === "eager")).toBe(true)
    expect(count(eager, "loaded")).toBe(100)
    //the flips changed an attribute, never the src: nothing was fetched again
    expect(server.requests.get("ok/0")).toBe(requestsBefore)
  })

  test("container resize keeps every loaded card's aspect", async ({
    page,
    browserName,
  }) => {
    await serveImages(page)
    await page.getByTestId("stress-image-count-100").click()
    await expect(page.locator(`${IMAGE}[data-image-loaded]`)).toHaveCount(
      100,
      { timeout: 10_000 },
    )
    const original = page.viewportSize()
    if (!original) throw new Error("the project has no viewport size")
    const narrow =
      browserName === "chromium"
        ? { width: 360, height: 740 }
        : { width: 320, height: 568 }
    const baseline = await snapshotCards(page)
    expectReservedBoxes(
      baseline,
      `resize baseline ${original.width}×${original.height}`,
    )

    await page.setViewportSize(narrow)
    //premise: the cards really got narrower with the viewport
    await expect
      .poll(async () => (await snapshotCards(page))[0]?.width)
      .toBeLessThan(baseline[0].width)
    const narrowed = await snapshotCards(page)
    expectReservedBoxes(
      narrowed,
      `resize ${narrow.width}×${narrow.height}`,
    )
    expect(count(narrowed, "loaded")).toBe(100)

    await page.setViewportSize(original)
    await expect
      .poll(async () => (await snapshotCards(page))[0]?.width)
      .toBeCloseTo(baseline[0].width, 0)
    const restored = await snapshotCards(page)
    expectReservedBoxes(restored, "resize restored")
    expect(count(restored, "loaded")).toBe(100)
  })
})

/* =============================================================================
 * Collapsible
 * ============================================================================= */

type PanelSnapshot = {
  triggerText: string
  expanded: string | null
  rootOpen: boolean
  panelOpen: boolean
  opening: boolean
  closing: boolean
  hidden: string | null
  inlineHeight: string
  overflow: string
  animations: number
  clientHeight: number
  contentHeight: number
  paragraphs: number
  /** How far (px) the lowest paragraph reaches past the panel's bottom edge. */
  clipped: number
}

/** One atomic read of the stress collapsible: the controlled state, the phase, the geometry. */
function snapshotPanel(page: Page): Promise<PanelSnapshot> {
  return page.evaluate(
    ({ panelSelector, triggerSelector }) => {
      const root = document.querySelector(
        '[data-testid="stress-collapsible"]',
      ) as HTMLElement
      const panel = root.querySelector(panelSelector) as HTMLElement
      const trigger = root.querySelector(triggerSelector) as HTMLElement
      const content = root.querySelector(
        '[data-testid="stress-collapsible-content"]',
      ) as HTMLElement
      const button = document.querySelector(
        '[data-testid="stress-collapsible-toggle"]',
      ) as HTMLElement
      const panelBox = panel.getBoundingClientRect()
      const paragraphs = [...content.querySelectorAll("p")]
      return {
        triggerText: button.textContent ?? "",
        expanded: trigger.getAttribute("aria-expanded"),
        rootOpen: root.getAttribute("data-collapsible-open") !== null,
        panelOpen: panel.getAttribute("data-collapsible-open") !== null,
        opening: panel.getAttribute("data-collapsible-opening") !== null,
        closing: panel.getAttribute("data-collapsible-closing") !== null,
        hidden: panel.getAttribute("hidden"),
        inlineHeight: panel.style.height,
        overflow: getComputedStyle(panel).overflow,
        animations: panel.getAnimations().length,
        clientHeight: panel.clientHeight,
        contentHeight: content.offsetHeight,
        paragraphs: paragraphs.length,
        clipped: Math.max(
          0,
          ...paragraphs.map(
            (p) => p.getBoundingClientRect().bottom - panelBox.bottom,
          ),
        ),
      }
    },
    { panelSelector: PANEL, triggerSelector: TRIGGER },
  )
}

/** Poll until no animation runs on the panel and neither phase attribute is present. */
async function awaitPanelRest(page: Page): Promise<PanelSnapshot> {
  await expect
    .poll(
      async () => {
        const s = await snapshotPanel(page)
        return s.animations === 0 && !s.opening && !s.closing
      },
      { timeout: 5_000, message: "the panel never came to rest" },
    )
    .toBe(true)
  return snapshotPanel(page)
}

/** The resting invariants: aria, presence attributes and geometry all agree. */
function expectPanelConsistent(s: PanelSnapshot, phase: string) {
  log(
    `${phase}: ${JSON.stringify({ text: s.triggerText, expanded: s.expanded, rootOpen: s.rootOpen, panelOpen: s.panelOpen, hidden: s.hidden, inlineHeight: s.inlineHeight, overflow: s.overflow, clientHeight: s.clientHeight, contentHeight: s.contentHeight, paragraphs: s.paragraphs, clipped: s.clipped })}`,
  )
  const open = s.rootOpen
  expect(s.expanded).toBe(String(open))
  expect(s.panelOpen).toBe(open)
  expect(s.triggerText).toContain(open ? "(open)" : "(closed)")
  expect(s.opening).toBe(false)
  expect(s.closing).toBe(false)
  if (open) {
    expect(s.hidden).toBeNull()
    //rests at auto: no inline height left behind by the transition
    expect(s.inlineHeight).toBe("")
    expect(s.clientHeight).toBe(s.contentHeight)
    expect(s.overflow).not.toBe("hidden")
    expect(s.clipped).toBeLessThanOrEqual(0.5)
  } else {
    expect(s.hidden).not.toBeNull()
    expect(s.clientHeight).toBe(0)
  }
}

test.describe("Collapsible under rapid toggling", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page)
    await page.getByTestId("stress-collapsible").scrollIntoViewIfNeeded()
  })

  for (const clicks of [20, 21]) {
    test(`${clicks} toggles as fast as Playwright clicks settle consistent, ending ${clicks % 2 ? "open" : "closed"}`, async ({
      page,
    }) => {
      //count the clicks that reached the button, in the page
      await page.evaluate(() => {
        const button = document.querySelector(
          '[data-testid="stress-collapsible-toggle"]',
        ) as HTMLElement
        const w = window as Window & { __toggleClicks?: number }
        w.__toggleClicks = 0
        button.addEventListener("click", () => {
          w.__toggleClicks = (w.__toggleClicks ?? 0) + 1
        })
      })
      const started = Date.now()
      const toggle = page.getByTestId("stress-collapsible-toggle")
      for (let i = 0; i < clicks; i++) await toggle.click()
      const elapsed = Date.now() - started
      const landed = await page.evaluate(
        () =>
          (window as Window & { __toggleClicks?: number }).__toggleClicks,
      )
      log(`${clicks} clicks in ${elapsed}ms (${landed} landed)`)
      expect(landed, "premise: every click reached the button").toBe(
        clicks,
      )
      const rest = await awaitPanelRest(page)
      expect(rest.rootOpen).toBe(clicks % 2 === 1)
      expectPanelConsistent(rest, `${clicks} toggles at rest`)
    })
  }

  test("content grows during the close and during the open", async ({
    page,
  }) => {
    await page.getByTestId("stress-collapsible-toggle").click()
    const opened = await awaitPanelRest(page)
    expectPanelConsistent(opened, "opened")
    expect(opened.paragraphs).toBe(3)

    //close, then grow inside the close's first frame: the close's target is 0
    //whatever the content does. A scripted `click()` returns before React commits
    //— a discrete update is flushed in a microtask, not on the handler's stack —
    //so the read waits one microtask; it does not wait a frame
    const closingSeen = await page.evaluate(async () => {
      const click = (id: string) =>
        (
          document.querySelector(`[data-testid="${id}"]`) as HTMLElement
        ).click()
      click("stress-collapsible-toggle")
      await Promise.resolve()
      const panel = document.querySelector(
        '[data-adaptv="collapsible-panel"]',
      ) as HTMLElement
      const closing =
        panel.getAttribute("data-collapsible-closing") !== null
      click("stress-collapsible-grow")
      return closing
    })
    expect(closingSeen, "premise: the grow landed while closing").toBe(
      true,
    )
    const closed = await awaitPanelRest(page)
    expectPanelConsistent(closed, "closed after mid-close grow")
    expect(closed.rootOpen).toBe(false)
    expect(closed.paragraphs).toBe(8)

    //open, then grow twice while the opening transition is running
    const openingSeen = await page.evaluate(async () => {
      const click = (id: string) =>
        (
          document.querySelector(`[data-testid="${id}"]`) as HTMLElement
        ).click()
      click("stress-collapsible-toggle")
      await Promise.resolve()
      const panel = document.querySelector(
        '[data-adaptv="collapsible-panel"]',
      ) as HTMLElement
      const opening =
        panel.getAttribute("data-collapsible-opening") !== null
      click("stress-collapsible-grow")
      click("stress-collapsible-grow")
      return opening
    })
    expect(openingSeen, "premise: the grows landed while opening").toBe(
      true,
    )
    const reopened = await awaitPanelRest(page)
    expectPanelConsistent(reopened, "open after mid-open grows")
    expect(reopened.rootOpen).toBe(true)
    expect(reopened.paragraphs).toBe(18)
  })

  test("a reversal mid-flight retargets: never both phases, settles under 2 s", async ({
    page,
  }) => {
    await page.getByTestId("stress-collapsible-toggle").click()
    expectPanelConsistent(await awaitPanelRest(page), "opened")

    //record every attribute mutation on the panel, looking for both phases at once
    await page.evaluate((panelSelector) => {
      const panel = document.querySelector(panelSelector) as HTMLElement
      const w = window as Window & {
        __bothPhases?: number
        __mutations?: number
      }
      w.__bothPhases = 0
      w.__mutations = 0
      new MutationObserver(() => {
        w.__mutations = (w.__mutations ?? 0) + 1
        if (
          panel.hasAttribute("data-collapsible-opening") &&
          panel.hasAttribute("data-collapsible-closing")
        ) {
          w.__bothPhases = (w.__bothPhases ?? 0) + 1
        }
      }).observe(panel, { attributes: true })
    }, PANEL)

    await page.getByTestId("stress-collapsible-toggle").click()
    await expect(page.locator(PANEL)).toHaveAttribute(
      "data-collapsible-closing",
      "",
    )
    //reverse it from the page and time the settle with a rAF loop (the instrument,
    //not a sleep): resolves the ms from the click to the first frame at rest
    const result = await page.evaluate(
      (panelSelector) =>
        new Promise<{
          wasClosing: boolean
          heightAtReversal: number
          settleMs: number
          bothPhases: number
          mutations: number
        }>((resolve) => {
          const panel = document.querySelector(
            panelSelector,
          ) as HTMLElement
          const wasClosing = panel.hasAttribute("data-collapsible-closing")
          const heightAtReversal = panel.getBoundingClientRect().height
          ;(
            document.querySelector(
              '[data-testid="stress-collapsible-toggle"]',
            ) as HTMLElement
          ).click()
          const t0 = performance.now()
          const w = window as Window & {
            __bothPhases?: number
            __mutations?: number
          }
          const check = () => {
            const atRest =
              panel.getAnimations().length === 0 &&
              !panel.hasAttribute("data-collapsible-opening") &&
              !panel.hasAttribute("data-collapsible-closing")
            const elapsed = performance.now() - t0
            if (atRest || elapsed > 4_000) {
              resolve({
                wasClosing,
                heightAtReversal,
                settleMs: atRest ? elapsed : -1,
                bothPhases: w.__bothPhases ?? 0,
                mutations: w.__mutations ?? 0,
              })
            } else requestAnimationFrame(check)
          }
          requestAnimationFrame(check)
        }),
      PANEL,
    )
    log(`reversal: ${JSON.stringify(result)}`)
    expect(result.wasClosing, "premise: reversed while closing").toBe(true)
    //premise: the close had moved — a reversal at full height is not mid-flight
    expect(result.heightAtReversal).toBeGreaterThan(0)
    expect(result.bothPhases).toBe(0)
    expect(result.settleMs).toBeGreaterThanOrEqual(0)
    expect(result.settleMs).toBeLessThan(2_000)
    const rest = await awaitPanelRest(page)
    expect(rest.rootOpen).toBe(true)
    expectPanelConsistent(rest, "after reversal")
  })
})

/* =============================================================================
 * Skeleton and Spinner fields
 * ============================================================================= */

type FieldStates = {
  skeletons: number
  skeletonRunning: number
  skeletonNames: string[]
  spinners: number
  spinnerRunning: number
  spinnerOffscreen: number
  spinnerNames: string[]
  regionBusy: string | null
  announcers: number
}

/** The two fields as the engine sees them: counts, play states, the animation names. */
function fieldStates(page: Page): Promise<FieldStates> {
  return page.evaluate(
    ({ skeleton, spinner, announcer }) => {
      const names = new Set<string>()
      const running = (selector: string, into: Set<string>) => {
        let n = 0
        for (const el of document.querySelectorAll(selector)) {
          const animation = el.getAnimations({ subtree: true })[0]
          if (!animation) continue
          into.add((animation as CSSAnimation).animationName ?? "?")
          if (animation.playState === "running") n += 1
        }
        return n
      }
      const spinnerNames = new Set<string>()
      return {
        skeletons: document.querySelectorAll(skeleton).length,
        skeletonRunning: running(skeleton, names),
        skeletonNames: [...names],
        spinners: document.querySelectorAll(spinner).length,
        spinnerRunning: running(spinner, spinnerNames),
        spinnerOffscreen: document.querySelectorAll(
          `${spinner}[data-spinner-offscreen]`,
        ).length,
        spinnerNames: [...spinnerNames],
        regionBusy:
          document
            .querySelector('[data-testid="stress-skeleton-field"]')
            ?.getAttribute("aria-busy") ?? null,
        announcers: document.querySelectorAll(announcer).length,
      }
    },
    { skeleton: SKELETON, spinner: SPINNER, announcer: ANNOUNCER },
  )
}

async function mountFields(page: Page, count: 1 | 200) {
  await page.getByTestId(`stress-skeleton-count-${count}`).click()
  await page.getByTestId(`stress-spinner-count-${count}`).click()
  await expect(page.locator(SKELETON)).toHaveCount(count)
  await expect(page.locator(SPINNER)).toHaveCount(count)
  //the spinner field must be ON screen: off screen the shared observer pauses it
  await page.getByTestId("stress-spinner-field").scrollIntoViewIfNeeded()
  await expect
    .poll(async () => {
      const s = await fieldStates(page)
      return `${s.spinnerRunning}/${s.spinnerOffscreen}/${s.skeletonRunning}`
    })
    .toBe(`${count}/0/${count}`)
  return fieldStates(page)
}

test.describe("Skeleton and Spinner fields", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page)
  })

  test("200 of each animate on screen, and unmounting leaves nothing behind", async ({
    page,
  }) => {
    const mounted = await mountFields(page, 200)
    log(`mounted: ${JSON.stringify(mounted)}`)
    expect(mounted.skeletonNames).toEqual(["adaptv-skeleton-pulse"])
    expect(mounted.spinnerNames).toEqual(["adaptv-spinner-spin"])
    expect(mounted.regionBusy).toBe("true")
    expect(mounted.announcers).toBeLessThanOrEqual(1)

    await page.getByTestId("stress-spinner-count-0").click()
    await page.getByTestId("stress-skeleton-count-0").click()
    await expect(page.locator(SPINNER)).toHaveCount(0)
    await expect(page.locator(SKELETON)).toHaveCount(0)
    const unmounted = await fieldStates(page)
    log(`unmounted: ${JSON.stringify(unmounted)}`)
    expect(
      await page.locator('[data-adaptv="spinner"]').count(),
      "no spinner anywhere on the page",
    ).toBe(0)
    expect(unmounted.announcers).toBeLessThanOrEqual(1)
    expect(unmounted.regionBusy).toBeNull()
  })
})

/*
 * The idle cost, chromium only (CPU throttling and Performance.getMetrics are CDP).
 * Four phases on one page, the main thread throttled 4×, each a 2 s window measured
 * BY a requestAnimationFrame loop in the page (its tick count and the intervals
 * between its ticks are readings, so the window is the instrument, not a sleep):
 * the fields empty (the control), one skeleton and one spinner, two hundred of
 * each, and two hundred of each with their animations switched off — the last one
 * attributes any cost to the motion or to the DOM.
 *
 * Measured before the bounds were written (prove-the-page-idles): Chromium recalcs
 * style once per frame for as long as ANY keyframe animation runs on the page, a
 * composited opacity or transform included — that is how computed style stays in
 * step with the compositor — and not at all with `animation: none` on the same DOM
 * (control 2, 200 + 200 = 213 over 211 ticks, animation none 0). The recalc count
 * is the engine's per-frame tick, not a per-element cost, so "what an empty page
 * costs" is the wrong control. The claim is that four hundred animated nodes cost
 * the throttled main thread what two cost: the same recalcs per tick, no long
 * task, no layout, and the typical frame no longer.
 *
 * The frame bound is the MEDIAN interval, measured four times on a 120 Hz host
 * before it was set (per-frame-assertions-need-the-right-statistic): pair 8.2–8.3
 * ms every time; fields 8.6 / 8.3 / 8.5 ms on a quiet host (p90 16.5 / 10.1 /
 * 16.5 — some frames do double under 400 nodes, so the p90 is printed, not
 * bounded) and 17.8 ms once, while another suite held four browsers on the same
 * machine. A median at 1.25× is far above the quiet runs and far below that one,
 * and when it trips the reading to check first is the host's load, not the CSS.
 */
test.describe("Skeleton and Spinner idle cost (chromium, CDP)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "CDP only")

  const WINDOW_MS = 2_000

  type Reading = {
    rafTicks: number
    longTasks: number
    medianIntervalMs: number
    p90IntervalMs: number
    style: number
    layout: number
  }

  async function metrics(cdp: CDPSession) {
    const { metrics } = await cdp.send("Performance.getMetrics")
    const value = (name: string) =>
      metrics.find((m) => m.name === name)?.value ?? Number.NaN
    return {
      style: value("RecalcStyleCount"),
      layout: value("LayoutCount"),
    }
  }

  /**
   * One window: rAF ticks, the median and p90 interval between them, and long
   * tasks counted in the page; recalc/layout deltas from CDP.
   */
  async function measure(
    page: Page,
    cdp: CDPSession,
    phase: string,
  ): Promise<Reading> {
    const before = await metrics(cdp)
    const inPage = await page.evaluate(
      (windowMs) =>
        new Promise<{
          rafTicks: number
          longTasks: number
          medianIntervalMs: number
          p90IntervalMs: number
        }>((resolve) => {
          let longTasks = 0
          const observer = new PerformanceObserver((list) => {
            longTasks += list.getEntries().length
          })
          observer.observe({ type: "longtask" })
          const ticks: number[] = []
          const start = performance.now()
          const tick = (now: number) => {
            ticks.push(now)
            if (performance.now() - start < windowMs)
              requestAnimationFrame(tick)
            else {
              observer.disconnect()
              const intervals = ticks
                .slice(1)
                .map((t, i) => t - ticks[i])
                .sort((a, b) => a - b)
              const at = (q: number) =>
                intervals[
                  Math.min(
                    intervals.length - 1,
                    Math.floor(q * intervals.length),
                  )
                ] ?? Number.NaN
              resolve({
                rafTicks: ticks.length,
                longTasks,
                medianIntervalMs: at(0.5),
                p90IntervalMs: at(0.9),
              })
            }
          }
          requestAnimationFrame(tick)
        }),
      WINDOW_MS,
    )
    const after = await metrics(cdp)
    const reading = {
      ...inPage,
      style: after.style - before.style,
      layout: after.layout - before.layout,
    }
    log(`idle ${phase}: ${JSON.stringify(reading)}`)
    return reading
  }

  const perTick = (r: Reading) => r.style / r.rafTicks

  test("200 pulses and 200 turns cost the throttled main thread what one of each costs", async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await openHarness(page)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Performance.enable")
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })

    //control: the same page, the fields empty, the spinner field's spot on screen
    await page.getByTestId("stress-spinner-field").scrollIntoViewIfNeeded()
    const empty = await fieldStates(page)
    expect(
      empty.skeletons + empty.spinners,
      "premise: control is empty",
    ).toBe(0)
    const control = await measure(page, cdp, "control (0 + 0)")

    //one of each: the engine's per-frame tick for a running animation
    const pairMounted = await mountFields(page, 1)
    expect(pairMounted.spinnerRunning).toBe(1)
    expect(pairMounted.skeletonRunning).toBe(1)
    const pair = await measure(page, cdp, "one of each (1 + 1 animating)")

    const mounted = await mountFields(page, 200)
    expect(mounted.spinnerRunning).toBe(200)
    expect(mounted.skeletonRunning).toBe(200)
    const fields = await measure(page, cdp, "fields (200 + 200 animating)")

    //diagnostic: the same DOM with the motion off, to attribute any difference
    const override = await page.addStyleTag({
      content: `${SKELETON}, ${SPINNER} { animation: none !important; }`,
    })
    await expect
      .poll(async () => {
        const s = await fieldStates(page)
        return s.skeletonRunning + s.spinnerRunning
      })
      .toBe(0)
    const still = await measure(page, cdp, "fields, animation none")
    await override.evaluate((node) => (node as HTMLElement).remove())
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })

    log(
      `idle summary: control ${JSON.stringify(control)} · pair ${JSON.stringify(pair)} · fields ${JSON.stringify(fields)} · still ${JSON.stringify(still)} · recalcs per tick pair ${perTick(pair).toFixed(3)} fields ${perTick(fields).toFixed(3)}`,
    )
    //premise: the windows really ran frames under the throttle
    for (const r of [control, pair, fields, still])
      expect(r.rafTicks).toBeGreaterThan(30)
    //premise: the recalcs are the animation's — with it off, the DOM costs nothing
    expect(still.style).toBeLessThanOrEqual(control.style + 2)
    //no window had a task over 50 ms, even at 4× throttle
    for (const r of [control, pair, fields, still])
      expect(r.longTasks).toBe(0)
    //nothing lays out: opacity and transform only
    expect(fields.layout).toBeLessThanOrEqual(pair.layout + 2)
    //four hundred animated nodes tick like two
    expect(perTick(fields)).toBeLessThanOrEqual(perTick(pair) + 0.1)
    //and the typical frame is no longer than with two
    expect(fields.medianIntervalMs).toBeLessThanOrEqual(
      pair.medianIntervalMs * 1.25,
    )
  })
})

/* =============================================================================
 * ProgressBar
 * ============================================================================= */

type BarSnapshot = {
  valueNow: string | null
  valueMin: string | null
  valueMax: string | null
  role: string | null
  indeterminate: boolean
  offscreen: boolean
  progressVar: string
  transform: string
  animationNames: string[]
  playStates: string[]
  transitions: number
}

function snapshotBar(page: Page): Promise<BarSnapshot> {
  return page.getByTestId("stress-progress").evaluate((el) => {
    const indicator = el.querySelector(
      '[data-part="indicator"]',
    ) as HTMLElement
    //the determinate fill eases over a 200 ms `transition`, which `getAnimations`
    //also lists — as a CSSTransition with no `animationName`; only the keyframe
    //animations (the sweep, the pulse) are the mode's, so only those are read
    const animations = indicator
      .getAnimations()
      .filter((a) => a instanceof CSSAnimation)
    return {
      valueNow: el.getAttribute("aria-valuenow"),
      valueMin: el.getAttribute("aria-valuemin"),
      valueMax: el.getAttribute("aria-valuemax"),
      role: el.getAttribute("role"),
      indeterminate:
        el.getAttribute("data-progress-bar-indeterminate") !== null,
      offscreen: el.getAttribute("data-progress-bar-offscreen") !== null,
      progressVar: (el as HTMLElement).style.getPropertyValue(
        "--progress-value",
      ),
      transform: getComputedStyle(indicator).transform,
      animationNames: animations.map(
        (a) => (a as CSSAnimation).animationName,
      ),
      playStates: animations.map((a) => a.playState),
      transitions: indicator
        .getAnimations()
        .filter((a) => a instanceof CSSTransition).length,
    }
  })
}

/** scaleX from a computed `matrix(a, b, c, d, tx, ty)`; NaN for anything else. */
function scaleXOf(transform: string): number {
  if (transform === "none") return 1
  const m = transform.match(/^matrix\(([^,]+),/)
  return m ? Number(m[1]) : Number.NaN
}

test.describe("ProgressBar", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page)
    await page.getByTestId("stress-progress").scrollIntoViewIfNeeded()
  })

  test("out-of-range and non-finite values clamp or go indeterminate", async ({
    page,
  }) => {
    const cases: Array<[string, string | null, string | null]> = [
      ["0", "0", "0"],
      ["1", "100", "1"],
      ["-1", "0", "0"],
      ["1.5", "100", "1"],
      ["NaN", null, ""],
      ["none", null, ""],
    ]
    for (const [name, valueNow, progressVar] of cases) {
      await page.getByTestId(`stress-progress-set-${name}`).click()
      await expect
        .poll(async () => (await snapshotBar(page)).valueNow)
        .toBe(valueNow)
      const bar = await snapshotBar(page)
      log(`set ${name}: ${JSON.stringify(bar)}`)
      expect(bar.role).toBe("progressbar")
      expect(bar.progressVar).toBe(progressVar)
      expect(bar.indeterminate).toBe(valueNow === null)
      if (valueNow === null) {
        expect(bar.valueMin).toBeNull()
        expect(bar.valueMax).toBeNull()
        expect(bar.animationNames).toEqual(["adaptv-progress-bar-sweep"])
        expect(bar.playStates).toEqual(["running"])
      } else {
        expect(bar.valueMin).toBe("0")
        expect(bar.valueMax).toBe("100")
        expect(bar.animationNames).toEqual([])
      }
    }
  })

  test("driven every frame for 5 s: the DOM matches the last frame written", async ({
    page,
  }) => {
    const issues = collectConsole(page)
    const frames = page.getByTestId("stress-progress-frames")
    await expect(frames).toHaveText("—")
    await page.getByTestId("stress-progress-drive").click()
    await expect(frames).not.toHaveText("—", { timeout: 8_000 })
    const n = Number(await frames.textContent())
    const fraction = (n % 120) / 120
    const percent = Math.round(fraction * 100)
    log(`drive: ${n} frames, last value ${fraction} → ${percent}%`)
    expect(
      n,
      "premise: the drive ran at frame rate",
    ).toBeGreaterThanOrEqual(60)
    await expect(page.getByTestId("stress-progress")).toHaveAttribute(
      "aria-valuenow",
      String(percent),
    )
    const bar = await snapshotBar(page)
    expect(Number(bar.progressVar)).toBeCloseTo(fraction, 9)
    expect(bar.indeterminate).toBe(false)
    //the fill eases over 200 ms; poll the computed scaleX to the written fraction
    await expect
      .poll(async () => scaleXOf((await snapshotBar(page)).transform), {
        timeout: 2_000,
      })
      .toBeCloseTo(fraction, 2)
    log(`drive: console ${JSON.stringify(issues)}`)
    expect(issues).toEqual([])
  })

  test("mode flipped every frame for 5 s: the final mode follows the frame parity", async ({
    page,
  }) => {
    const issues = collectConsole(page)
    const frames = page.getByTestId("stress-progress-frames")
    const started = Date.now()
    await page.getByTestId("stress-progress-flip").click()
    await expect(frames).not.toHaveText("—", { timeout: 8_000 })
    const elapsed = Date.now() - started
    const n = Number(await frames.textContent())
    const finalIndeterminate = n % 2 === 0
    const bar = await snapshotBar(page)
    log(
      `flip: ${n} frames in ${elapsed}ms → ${finalIndeterminate ? "indeterminate" : "0.5"} · ${JSON.stringify(bar)} · announcers ${await page.locator(ANNOUNCER).count()}`,
    )
    //the premise is that the mode flipped on most frames, not a frame rate:
    //starting and stopping the sweep every frame costs Linux WebKit on the
    //4-vCPU runner ~95 ms a frame (56-58 frames in 5.5 s, against ~200 when only
    //the value changes), so 30 flips still drive the bar through every mode
    //change the assertions below read
    expect(
      n,
      "premise: the mode flipped every frame",
    ).toBeGreaterThanOrEqual(30)
    expect(bar.indeterminate).toBe(finalIndeterminate)
    expect(bar.valueNow).toBe(finalIndeterminate ? null : "50")
    expect(bar.progressVar).toBe(finalIndeterminate ? "" : "0.5")
    //on screen, so no pause stamp may be left by the observer churn
    expect(bar.offscreen).toBe(false)
    expect(bar.animationNames).toEqual(
      finalIndeterminate ? ["adaptv-progress-bar-sweep"] : [],
    )
    expect(await page.locator(ANNOUNCER).count()).toBeLessThanOrEqual(1)
    expect(issues).toEqual([])
  })
})

/* =============================================================================
 * Text
 * ============================================================================= */

const TEXT_IDS = [
  "stress-text-long",
  "stress-text-rtl",
  "stress-text-cjk",
] as const

type TextSnapshot = {
  id: string
  inlineClamp: string
  display: string
  overflow: string
  direction: string
  lang: string
  lineHeight: number
  clientHeight: number
  scrollHeight: number
  textLength: number
}

function snapshotTexts(page: Page): Promise<TextSnapshot[]> {
  return page.evaluate(
    (ids) =>
      ids.map((id) => {
        const el = document.querySelector(
          `[data-testid="${id}"]`,
        ) as HTMLElement
        const cs = getComputedStyle(el)
        return {
          id,
          inlineClamp: el.style.webkitLineClamp,
          display: cs.display,
          overflow: cs.overflow,
          direction: cs.direction,
          lang: el.lang,
          lineHeight: Number.parseFloat(cs.lineHeight),
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          textLength: el.textContent?.length ?? 0,
        }
      }),
    [...TEXT_IDS],
  )
}

/** The clamp-N relations on all three samples. */
function expectClamped(texts: TextSnapshot[], n: number, phase: string) {
  log(`${phase}: ${JSON.stringify(texts)}`)
  for (const t of texts) {
    expect(t.inlineClamp, t.id).toBe(String(n))
    //the authored `display: -webkit-box` computes to `-webkit-box` on WebKit and to
    //`flow-root` on a Chromium that implements the standard `line-clamp`, which
    //maps the legacy pair onto it (CSS Overflow 4); the clamp's own claim is the
    //height below, and that is what both engines must meet
    expect(["-webkit-box", "flow-root"], t.id).toContain(t.display)
    expect(t.overflow, t.id).toBe("hidden")
    expect(
      Number.isFinite(t.lineHeight),
      `${t.id} has a px line-height`,
    ).toBe(true)
    //premise: the text really overflows the clamp, so the height is the clamp's
    expect(t.scrollHeight, `${t.id} overflows`).toBeGreaterThan(
      t.clientHeight,
    )
    expect(
      Math.abs(t.clientHeight - n * t.lineHeight),
      `${t.id} height vs ${n} lines`,
    ).toBeLessThanOrEqual(1)
  }
}

test.describe("Text", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page)
    await page.getByTestId("stress-text-long").scrollIntoViewIfNeeded()
  })

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = ""
    })
  })

  test("clamp 0..3 on 10 000 chars, RTL and CJK, at 100% and 200% root font size", async ({
    page,
  }) => {
    const premise = await snapshotTexts(page)
    expect(premise[0].textLength).toBe(10_000)
    expect(premise[1].direction).toBe("rtl")
    expect(premise[2].lang).toBe("ja")

    const unclamped = await snapshotTexts(page)
    log(`clamp 0: ${JSON.stringify(unclamped)}`)
    for (const t of unclamped) {
      expect(t.inlineClamp, t.id).toBe("")
      expect(t.display, t.id).not.toBe("-webkit-box")
      expect(t.scrollHeight, t.id).toBe(t.clientHeight)
    }
    for (const n of [1, 2, 3]) {
      await page.getByTestId(`stress-text-clamp-${n}`).click()
      await expect
        .poll(async () => (await snapshotTexts(page))[0].inlineClamp)
        .toBe(String(n))
      expectClamped(await snapshotTexts(page), n, `clamp ${n}`)
    }

    //the root font doubled: the line-height must double with it and the page
    //must not grow a horizontal scrollbar
    const baseLineHeight = unclamped[0].lineHeight
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%"
    })
    await expect
      .poll(async () => (await snapshotTexts(page))[0].lineHeight)
      .toBeGreaterThan(baseLineHeight * 1.9)
    for (const n of [3, 2, 1]) {
      await page.getByTestId(`stress-text-clamp-${n}`).click()
      await expect
        .poll(async () => (await snapshotTexts(page))[0].inlineClamp)
        .toBe(String(n))
      const texts = await snapshotTexts(page)
      expectClamped(texts, n, `clamp ${n} at 200%`)
      expect(texts[0].lineHeight).toBeGreaterThan(baseLineHeight * 1.9)
    }
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement?.scrollWidth ?? -1,
      clientWidth: document.scrollingElement?.clientWidth ?? -1,
    }))
    log(`page at 200%: ${JSON.stringify(overflow)}`)
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  })

  test("reclamping 10 000 chars is under 500 ms a step", async ({
    page,
  }) => {
    const steps = await page.evaluate(async () => {
      const el = document.querySelector(
        '[data-testid="stress-text-long"]',
      ) as HTMLElement
      const timings: Array<{ clamp: number; ms: number; height: number }> =
        []
      for (const clamp of [2, 0, 3]) {
        const button = document.querySelector(
          `[data-testid="stress-text-clamp-${clamp}"]`,
        ) as HTMLElement
        const t0 = performance.now()
        button.click()
        //React commits a discrete update in a microtask, after the handler's
        //stack unwinds: one await, and the commit is in the step's cost
        await Promise.resolve()
        //a synchronous layout read, so the step's cost includes the relayout
        const height = el.offsetHeight
        timings.push({ clamp, ms: performance.now() - t0, height })
      }
      return timings
    })
    log(`reclamp: ${JSON.stringify(steps)}`)
    //premise: each step really changed the box
    expect(steps[0].height).toBeLessThan(steps[1].height)
    expect(steps[2].height).toBeLessThan(steps[1].height)
    for (const step of steps) expect(step.ms).toBeLessThan(500)
  })
})

/* =============================================================================
 * Nested scrollers
 * ============================================================================= */

type ScrollerSnapshot = {
  innerScrollWidth: number
  innerClientWidth: number
  innerScrollLeft: number
  outerScrollHeight: number
  outerClientHeight: number
  outerScrollLeft: number
  pageScrollLeft: number
  pageScrollWidth: number
  pageClientWidth: number
  viewPaddingBottom: string
  outerOverflowX: string
  outerOverflowY: string
  innerOverflowX: string
  innerOverflowY: string
}

function snapshotScrollers(page: Page): Promise<ScrollerSnapshot> {
  return page.evaluate(() => {
    const view = document.querySelector(
      '[data-testid="stress-view-safe"]',
    ) as HTMLElement
    const outer = view.querySelector(
      '[data-adaptv="scroll-view"]',
    ) as HTMLElement
    const inner = outer.querySelector(
      '[data-adaptv="scroll-view"][data-scroll-view="x"]',
    ) as HTMLElement
    const scroller = document.scrollingElement as HTMLElement
    return {
      innerScrollWidth: inner.scrollWidth,
      innerClientWidth: inner.clientWidth,
      innerScrollLeft: inner.scrollLeft,
      outerScrollHeight: outer.scrollHeight,
      outerClientHeight: outer.clientHeight,
      outerScrollLeft: outer.scrollLeft,
      pageScrollLeft: scroller.scrollLeft,
      pageScrollWidth: scroller.scrollWidth,
      pageClientWidth: scroller.clientWidth,
      viewPaddingBottom: getComputedStyle(view).paddingBottom,
      outerOverflowX: getComputedStyle(outer).overflowX,
      outerOverflowY: getComputedStyle(outer).overflowY,
      innerOverflowX: getComputedStyle(inner).overflowX,
      innerOverflowY: getComputedStyle(inner).overflowY,
    }
  })
}

test.describe("Nested scrollers", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page)
    await page.getByTestId("stress-view-safe").scrollIntoViewIfNeeded()
  })

  test("the inner strip scrolls to its end without moving the outer or the page", async ({
    page,
  }) => {
    const before = await snapshotScrollers(page)
    log(`scrollers: ${JSON.stringify(before)}`)
    //premises: both axes really overflow
    expect(before.innerScrollWidth).toBeGreaterThan(
      before.innerClientWidth,
    )
    expect(before.outerScrollHeight).toBeGreaterThan(
      before.outerClientHeight,
    )
    expect(["auto", "scroll"]).toContain(before.outerOverflowY)
    expect(before.outerOverflowX).toBe("hidden")
    expect(["auto", "scroll"]).toContain(before.innerOverflowX)
    expect(before.innerOverflowY).toBe("hidden")
    expect(before.viewPaddingBottom).toMatch(/^\d+(\.\d+)?px$/)
    expect(
      Number.parseFloat(before.viewPaddingBottom),
    ).toBeGreaterThanOrEqual(0)

    await page.evaluate(() => {
      const inner = document.querySelector(
        '[data-testid="stress-view-safe"] [data-scroll-view="x"]',
      ) as HTMLElement
      inner.scrollLeft = inner.scrollWidth
    })
    await expect
      .poll(async () => (await snapshotScrollers(page)).innerScrollLeft)
      .toBeGreaterThan(0)
    const after = await snapshotScrollers(page)
    log(`inner at end: ${JSON.stringify(after)}`)
    expect(after.innerScrollLeft).toBeGreaterThanOrEqual(
      after.innerScrollWidth - after.innerClientWidth - 1,
    )
    expect(after.outerScrollLeft).toBe(0)
    expect(after.pageScrollLeft).toBe(0)
    expect(after.pageScrollWidth).toBeLessThanOrEqual(
      after.pageClientWidth,
    )
  })

  test("the page never scrolls sideways across viewport swaps", async ({
    page,
    browserName,
  }) => {
    const original = page.viewportSize()
    expect(original).not.toBeNull()
    const sizes =
      browserName === "chromium"
        ? [
            { width: 320, height: 568 },
            { width: 1280, height: 720 },
            { width: 320, height: 568 },
          ]
        : [
            { width: 320, height: 568 },
            { width: 390, height: 844 },
          ]
    const before = await snapshotScrollers(page)
    expect(before.pageScrollWidth).toBeLessThanOrEqual(
      before.pageClientWidth,
    )
    for (const size of sizes) {
      await page.setViewportSize(size)
      await expect
        .poll(
          async () => (await snapshotScrollers(page)).pageClientWidth,
          {
            message: "premise: the viewport really changed",
          },
        )
        .toBeLessThanOrEqual(size.width)
      const s = await snapshotScrollers(page)
      log(`viewport ${size.width}×${size.height}: ${JSON.stringify(s)}`)
      expect(s.pageScrollWidth).toBeLessThanOrEqual(s.pageClientWidth)
      expect(s.innerScrollWidth).toBeGreaterThan(s.innerClientWidth)
    }
    if (original) await page.setViewportSize(original)
  })
})
