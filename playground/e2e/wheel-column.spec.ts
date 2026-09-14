import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * WheelColumn — the iOS picker drum, measured as the native scroller it is.
 *
 * The wheel IS the scroller: every index it reports is `scrollTop / itemHeight`.
 * It ships NO css scroll-snap on purpose (that truncates a fling to a crawl on
 * iOS) and JS-snaps once the glide settles. The two guarantees worth pinning are
 * reachable through the real scroll pipeline: any rest lands on a WHOLE row, and
 * the centred value follows the drum row by row rather than jumping only on rest.
 *
 * Driven with `mouse.wheel` after three instruments were tried and rejected:
 *   - `el.scrollTop = …` is a jump, not a gesture: nothing coasts and nothing rolls
 *     row by row. The write always fires ONE scroll event; hydration is only what
 *     attaches React's `onScroll` to it. The settle test at the bottom records that
 *     event on both engines and relies on it.
 *   - CDP `Input.dispatchTouchEvent` works from mid-list but is swallowed on the
 *     first gesture and will not engage a compositor scroll that BEGINS at
 *     scrollTop 0 (a CDP quirk — a real finger scrolls down from the top on the
 *     device, confirmed on the iOS sim).
 *   - `mouse.wheel` fires a genuine scroll event with neither trap.
 *
 * Two rules this page cost real time to learn, kept here so the next spec skips it:
 *   1. `scrollIntoViewIfNeeded()` the wheel FIRST — it sits far down a scrolling
 *      page, and aiming at its off-screen box makes the suite pass vacuously.
 *   2. The scroll a `mouse.wheel` triggers is ASYNC — reading `scrollTop`/the
 *      active row on the very next line reads the STALE pre-scroll value. Always
 *      settle (poll / wait) before asserting.
 *
 * ⚠︎ The SCROLL tests are chromium-only. Android WebView engine; iOS WebKit (longer
 * fling) is a sim walk. That is ENFORCED by the skip in their describe rather than
 * just written down: the webkit project is a mobile device profile, where
 * `mouse.wheel` throws "Mouse wheel is not supported in mobile WebKit". Every webkit
 * run failed on it deterministically — retries only made it fail three times
 * instead of once. The KEYBOARD and SETTLE tests at the bottom need no wheel and run
 * on both.
 */

test.use({ viewport: { width: 390, height: 844 } })

const HOUR = '[aria-label="Hour"]'
const ITEM_H = 30
const LAST_HOUR = 23
const START = 9 // the lab's default centred hour (scrollTop 270)

const hourScrollTop = (page: Page) =>
  page.$eval(HOUR, (el) => (el as HTMLElement).scrollTop)

const activeHour = (page: Page) =>
  page.locator(`${HOUR} button[data-active="true"]`).first().innerText()

const label = (n: number) => String(n).padStart(2, "0")
const expectedLabel = (top: number) =>
  label(Math.min(LAST_HOUR, Math.max(0, Math.round(top / ITEM_H))))

// these tests time the async scroll pipeline. Five of them racing each other for
// one single-threaded dev server starves the timing and they flake; serial mode
// runs them in one worker (still parallel against OTHER spec files).
//
// The `retries: 2` that used to sit here was charged to "residual load spikes".
// It was paying for two real bugs instead: the tap test asserting mid-glide, and
// every test driving a drum React had not mounted yet. Both are fixed above, so
// the retries are gone and a red run means a real one.
test.describe.configure({ mode: "serial" })

/*
 * The whole wheel is server-rendered, down to `data-active="true"` on the start row —
 * so without the hydration gate (`awaitClientHandover`, e2e/support/hydrated.ts) the
 * waits in `setup()` are all satisfied by inert HTML, and even its
 * `activeHour === START` assertion passes on a page React has never touched.
 * Everything this spec measures is client-only: `scrollTop` is seeded to the start row
 * by an effect, the value tracks the drum through `onScroll`, and a row tap rolls the
 * wheel from `onClick`. Fired before hydration, every one of those is silently dropped.
 */

/** Wait for the drum to truly SETTLE. `%ITEM_H≈0` alone is not enough —
 *  scrollTop sweeps THROUGH whole-row multiples during the glide, so a bare
 *  snap check returns mid-animation and reads a stale row. Wait for scrollTop
 *  to stop moving across a window AND be on a row. */
async function settle(page: Page) {
  await expect
    .poll(
      async () => {
        const a = await hourScrollTop(page)
        await page.waitForTimeout(120)
        const b = await hourScrollTop(page)
        return a === b ? b % ITEM_H : 999 // moving → keep polling
      },
      { timeout: 4000 },
    )
    .toBeLessThanOrEqual(1)
}

test.describe("WheelColumn as a native scroller", () => {
  let cx = 0
  let cy = 0

  test.beforeEach(({ browserName }) => {
    test.skip(
      browserName !== "chromium",
      "mouse.wheel is unsupported on the mobile WebKit profile",
    )
  })

  async function setup(page: Page) {
    await page.goto("/lab/wheel-column")
    await awaitClientHandover(page)
    await page.locator(HOUR).waitFor()
    await page
      .locator(`${HOUR} button[data-active="true"]`)
      .first()
      .waitFor()
    // the wheel is far down the page — bring it on screen, then park the mouse on it
    await page.locator(HOUR).scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    const box = await page.locator(HOUR).boundingBox()
    if (!box) throw new Error("the hour wheel has no layout box")
    cx = Math.round(box.x + box.width / 2)
    cy = Math.round(box.y + box.height / 2)
    await page.mouse.move(cx, cy)
    expect(await activeHour(page)).toBe(label(START))
  }

  /** Wheel over the drum, then wait for the scroll to truly settle. */
  async function wheel(page: Page, delta: number) {
    await page.mouse.move(cx, cy)
    await page.mouse.wheel(0, delta)
    await settle(page)
  }

  test("any rest position settles onto a whole row, never between two", async ({
    page,
  }) => {
    await setup(page)
    // a fractional distance — the classic 'rests between two rows' position.
    // wheel() itself asserts the JS-snap landed on a whole row.
    await wheel(page, ITEM_H * 3 + 15)
    expect(await activeHour(page)).toBe(
      expectedLabel(await hourScrollTop(page)),
    )
  })

  test("the centred value follows the drum row by row, not only its rest", async ({
    page,
  }) => {
    await setup(page)
    for (const _ of [1, 2, 3]) {
      await wheel(page, ITEM_H * 2)
      // the invariant: the displayed centred value always equals the row the drum
      // has scrolled to — never a lagged/only-on-rest value
      expect(
        await activeHour(page),
        "the value must match the row the drum is on",
      ).toBe(expectedLabel(await hourScrollTop(page)))
    }
    expect(
      await activeHour(page),
      "and the drum must have moved off the start row",
    ).not.toBe(label(START))
  })

  test("clamps at both ends — the value can't run past the list", async ({
    page,
  }) => {
    await setup(page)

    await wheel(page, ITEM_H * 40) // way past the bottom
    expect(await activeHour(page), "clamps to the last hour").toBe(
      label(LAST_HOUR),
    )
    expect(Math.round((await hourScrollTop(page)) / ITEM_H)).toBe(
      LAST_HOUR,
    )

    await wheel(page, -ITEM_H * 60) // way past the top
    expect(await activeHour(page), "clamps to 00").toBe("00")
    expect(await hourScrollTop(page)).toBeLessThanOrEqual(1)
  })

  test("a tap on an off-centre row rolls it to the centre", async ({
    page,
  }) => {
    await setup(page) // centred on START (09)
    await page
      .locator(`${HOUR} button`, {
        hasText: new RegExp(`^${label(START + 2)}$`),
      })
      .click()

    // the tap rolls the drum with a SMOOTH scroll, and the value is reported
    // live off `nearestIndex()` — so it flips to the tapped row the moment
    // scrollTop crosses the halfway mark, a fraction of a row before the roll
    // has arrived. Polling the value alone therefore returns mid-glide and the
    // scrollTop read on the next line was a whole 29 of 30px off the row. Same
    // rule as `wheel()`: settle first, assert after.
    await settle(page)
    await expect
      .poll(() => activeHour(page), {
        message: "tapping a row must roll it to the centre",
        timeout: 2000,
      })
      .toBe(label(START + 2))
    expect((await hourScrollTop(page)) % ITEM_H).toBeLessThanOrEqual(1)
  })

  test("reaching the wheel's end does not scroll the page underneath it", async ({
    page,
  }) => {
    await setup(page)
    await wheel(page, ITEM_H * 40) // drive the drum to its bottom
    expect(await activeHour(page)).toBe(label(LAST_HOUR))

    const pageScroll = () =>
      page.evaluate(() => {
        const el = document.querySelector("[data-scroll-view='y']")
        return el ? el.scrollTop : window.scrollY
      })
    const before = await pageScroll()
    await wheel(page, ITEM_H * 20) // keep pushing past the bottom
    expect(
      Math.abs((await pageScroll()) - before),
      "overscroll-contain must keep the page still while the wheel bottoms out",
    ).toBeLessThanOrEqual(4)
  })
})

/*
 * The keyboard path, on BOTH engines. It needs no `mouse.wheel`, so the webkit skip
 * above does not apply: a key rolls the drum through the same smooth scroll as a
 * tap, and the value is read off the real scroll pipeline once it settles.
 *
 * Before this path existed the column was unreachable on both: 200 Tab presses never
 * landed on it, `focus()` was refused, and ArrowDown left scrollTop where it was.
 *
 * Focus has to be SEEN, not just held (WCAG 2.4.7). The shipped `:focus-visible` ring
 * computes on the column but is drawn outside its border box, where the drum's mask
 * clips it to nothing — a focused and an unfocused column screenshot byte-identical on
 * webkit. So the test reads the paint: the centred row's computed outline, and the
 * decoded pixels of the column, which must CHANGE when keyboard focus leaves it.
 * Compared against each other in the same run, never against a golden file.
 */
/**
 * How many pixels differ between two screenshots of the same box, decoded in the page.
 *
 * Not `Buffer.equals`: the PNG ENCODING of two pixel-identical shots differs between
 * captures, so byte inequality passed even with the ring painted transparent. The
 * browser's own decoder is the dependency-free way to read the pixels back. And not
 * an exact compare either: pixel-identical frames still differ by 1 in a few
 * antialiased glyph edges on chromium, so a pixel counts only when its largest channel
 * moved by more than NOISE. A 2px ring in an accent colour moves far more than that.
 */
async function changedPixels(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(
    async ([first, second, NOISE]) => {
      const pixels = async (base64: string) => {
        const blob = await (
          await fetch(`data:image/png;base64,${base64}`)
        ).blob()
        const bitmap = await createImageBitmap(blob)
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext("2d")
        if (!context) throw new Error("no 2d context")
        context.drawImage(bitmap, 0, 0)
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const [x, y] = await Promise.all([pixels(first), pixels(second)])
      if (x.length !== y.length) return Number.POSITIVE_INFINITY
      let changed = 0
      for (let i = 0; i < x.length; i += 4) {
        const delta = Math.max(
          Math.abs(x[i] - y[i]),
          Math.abs(x[i + 1] - y[i + 1]),
          Math.abs(x[i + 2] - y[i + 2]),
          Math.abs(x[i + 3] - y[i + 3]),
        )
        if (delta > NOISE) changed++
      }
      return changed
    },
    [a.toString("base64"), b.toString("base64"), 48] as const,
  )
}

test.describe("WheelColumn from the keyboard", () => {
  test("a real Tab reaches the column, shows where it is, and the keys roll it row by row", async ({
    page,
  }) => {
    await page.goto("/lab/wheel-column")
    await awaitClientHandover(page)
    const hour = page.locator(HOUR)
    const centred = page.locator(`${HOUR} button[data-active="true"]`)
    await hour.scrollIntoViewIfNeeded()
    await expect(centred).toHaveText(label(START))

    //enter the way a keyboard user does: from the tab stop just before the column
    const before = await page.evaluate((selector) => {
      const column = document.querySelector(selector)
      const stops = [
        ...document.querySelectorAll<HTMLElement>(
          "a[href], button, input, select, textarea, [tabindex]",
        ),
      ].filter(
        (el) =>
          el.tabIndex >= 0 &&
          !el.hasAttribute("disabled") &&
          el.getClientRects().length > 0 &&
          column !== null &&
          column.compareDocumentPosition(el) &
            Node.DOCUMENT_POSITION_PRECEDING,
      )
      const last = stops.at(-1)
      if (!last) return null
      last.setAttribute("data-e2e-before-wheel", "")
      return last.outerHTML.slice(0, 80)
    }, HOUR)
    expect(
      before,
      "the lab page has a tab stop before the wheel",
    ).not.toBeNull()
    await page.locator("[data-e2e-before-wheel]").focus()
    await hour.scrollIntoViewIfNeeded()

    const outline = () =>
      centred.evaluate((row) => {
        const style = getComputedStyle(row)
        return `${style.outlineStyle} ${style.outlineWidth}`
      })
    expect(await outline()).not.toBe("solid 2px")

    await page.keyboard.press("Tab")
    await expect(hour).toBeFocused()
    expect(await outline(), "the centred row carries the focus ring").toBe(
      "solid 2px",
    )
    //both shots are taken at rest and at the same scroll: the only thing Tab changes
    //between them is which column holds focus, so a ring the mask clips (or one that
    //paints nothing) leaves them identical. The shot is the centred row less its right
    //edge, where mobile WebKit fades its overlay scroll indicator in and out on its own
    const box = await centred.boundingBox()
    if (!box) throw new Error("the centred row has no box")
    const shot = () =>
      page.screenshot({
        animations: "disabled",
        clip: {
          x: box.x,
          y: box.y,
          width: box.width - 16,
          height: box.height,
        },
      })
    const focused = await shot()

    //the rows are not tab stops, so the next stop is the neighbouring column
    await page.keyboard.press("Tab")
    await expect(page.locator('[aria-label="Minute"]')).toBeFocused()
    expect(await outline(), "and the ring leaves with the focus").not.toBe(
      "solid 2px",
    )
    expect(
      await changedPixels(page, focused, await shot()),
      "keyboard focus must change what the column paints",
    ).toBeGreaterThan(100)
    await page.keyboard.press("Shift+Tab")
    await expect(hour).toBeFocused()

    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await settle(page)
    expect(await activeHour(page)).toBe(label(START + 2))
    expect(await hourScrollTop(page)).toBe((START + 2) * ITEM_H)
    //the ring follows the centred row, not the row that had it
    expect(await outline()).toBe("solid 2px")

    await page.keyboard.press("End")
    await settle(page)
    expect(await activeHour(page)).toBe(label(LAST_HOUR))

    await page.keyboard.press("Home")
    await settle(page)
    expect(await activeHour(page)).toBe("00")
    expect(await hourScrollTop(page)).toBe(0)
  })
})

/*
 * The settle, on BOTH engines: it must not report the row the wheel already reported.
 *
 * The settle timer is armed by the scroll event that reported a row, in the render
 * before the consumer stored it, so a settle that read that render's `value` reported
 * the row a second time whenever a gesture's LAST scroll event was the one that
 * crossed. A real drag rarely ends that way on cue, so the test moves the drum exactly
 * one row with a single `scrollTop` write and counts what arrives: exactly one scroll
 * event (recorded, so a second one cannot hide the case) and exactly one onChange,
 * read off the lab page's `onChange calls` counter.
 */
test.describe("WheelColumn's settle", () => {
  test("a scroll whose one event crosses a row reports that row once, settle included", async ({
    page,
  }) => {
    await page.goto("/lab/wheel-column")
    await awaitClientHandover(page)
    const hour = page.locator(HOUR)
    await expect(
      page.locator(`${HOUR} button[data-active="true"]`),
    ).toHaveText(label(START))
    await hour.scrollIntoViewIfNeeded()
    await settle(page)

    const calls = () =>
      page.evaluate(() => {
        const name = [...document.querySelectorAll("span")].find(
          (span) => span.textContent === "onChange calls",
        )
        return Number(name?.nextElementSibling?.textContent)
      })
    expect(await calls()).toBe(0)

    await hour.evaluate((el) => {
      const events: number[] = []
      ;(window as { wheelScrolls?: number[] }).wheelScrolls = events
      el.addEventListener("scroll", () => events.push(el.scrollTop))
      el.scrollTop += 30
    })
    await expect(hour.locator('button[data-active="true"]')).toHaveText(
      label(START + 1),
    )
    //past the 120ms settle, with room for the render the report triggers
    await page.waitForTimeout(600)

    expect(
      await page.evaluate(
        () => (window as { wheelScrolls?: number[] }).wheelScrolls,
      ),
      "one scroll event, landing on the row it crossed into",
    ).toEqual([(START + 1) * ITEM_H])
    expect(await calls(), "one row crossed is one onChange").toBe(1)
  })
})
