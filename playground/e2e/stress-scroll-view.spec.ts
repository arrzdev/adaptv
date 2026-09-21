import type { CDPSession, Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import {
  awaitStable,
  installProbes,
  rafOverQuiet,
  readProbe,
  resetRafCounters,
} from "./support/stress-probes"

/*
 * ScrollView under stress — the scroller and its edge-fade hook when the world
 * changes under a live gesture: a programmatic `scrollTo` in the middle of a
 * touch scroll, `scrollEnabled` flipped off (and back on) mid-drag, the root
 * font size doubled, and the hook's own idle claim (one frame of work per scroll
 * burst, none at rest).
 *
 * Driver: CDP `Input.dispatchTouchEvent` — synthetic TouchEvents never drive
 * native scrolling (scroll-axis.spec.ts) — plus `page.mouse.wheel` for the rAF
 * case. chromium-only, enforced by the skip in `beforeEach`. `hasTouch` with a
 * PORTRAIT viewport, or the rotate guard covers the page.
 *
 * Every touch is aimed the way overscroll.spec.ts aims: bring the box on screen,
 * re-read its rect until it stops moving, confirm with `elementFromPoint`.
 * Premise per case: the finger really scrolled (asserted mid-gesture with
 * `expect.poll`, before anything is changed underneath it), the toggle really
 * took (the class flips), the font size really doubled (the box's px height
 * doubled), the hook really ran during the burst. No retries, no warm-ups.
 *
 * Not duplicated: "the inner box at its end does not scroll the page under a
 * continued pull" is overscroll.spec.ts's claim; see the report for whether it
 * asserts its premise.
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

const VERTICAL = "[data-lab-scroller='vertical']"
//the "fade — edges" demo box (fadeSize="2.5rem"), by the inline depth the prop
//writes — `[data-fade='both']` alone matches the PAGE's root scroller first,
//which is viewport-bound (844px tall, ~3 600px of extent) and not the box
const FADE_BOX = "[data-fade='both'][style*='--fade-length']"
//use-scroll-edge-fade.ts FADE_RAMP_PX
const RAMP_PX = 24

async function touch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  point?: { x: number; y: number },
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: point ? [{ x: point.x, y: point.y }] : [],
  })
}

/** Settle a box's rect, then confirm a point at `fractionY` of its height lands on it. */
async function aim(page: Page, target: Locator, fractionY = 0.5) {
  await target.scrollIntoViewIfNeeded()
  let previous = -1
  let rect = await target.boundingBox()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (rect && Math.round(rect.y) === previous) break
    previous = rect ? Math.round(rect.y) : -1
    await page.waitForTimeout(50)
    rect = await target.boundingBox()
  }
  if (!rect) throw new Error("the scroller has no layout box")
  const point = {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height * fractionY),
  }
  const hit = await target.evaluate(
    (el, [x, y]) => {
      const at = document.elementFromPoint(x as number, y as number)
      return {
        onTarget: at === el || (at ? el.contains(at) : false),
        what: at
          ? `${at.tagName}.${String(at.className).slice(0, 60)}`
          : "nothing",
      }
    },
    [point.x, point.y] as const,
  )
  if (!hit.onTarget) {
    throw new Error(
      `touch point ${point.x},${point.y} misses the scroller — hit ${hit.what}. Stale measurement, not the component`,
    )
  }
  return { rect, point }
}

const scrollTopOf = (target: Locator) =>
  target.evaluate((el) => el.scrollTop)
const extentOf = (target: Locator) =>
  target.evaluate((el) => el.scrollHeight - el.clientHeight)

const strengths = (target: Locator) =>
  target.evaluate((el) => ({
    start: Number(el.style.getPropertyValue("--fade-start")),
    end: Number(el.style.getPropertyValue("--fade-end")),
  }))

/** Drag `moves` steps of `dy` (negative = finger up = content scrolls down). */
async function moves(
  cdp: CDPSession,
  from: { x: number; y: number },
  count: number,
  dy: number,
  offset = 0,
) {
  for (let s = 1; s <= count; s += 1) {
    await touch(cdp, "touchMove", {
      x: from.x,
      y: from.y + offset + dy * s,
    })
  }
}

test.describe("ScrollView under stress", () => {
  test.describe.configure({ timeout: 120_000 })

  let errors: string[] = []

  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "CDP touch injection is chromium-only",
    )
    errors = []
    page.on("pageerror", (error) => errors.push(String(error)))
    await page.addInitScript(installProbes)
    await page.goto("/lab/view-scroll")
    await awaitClientHandover(page)
    await expect(page.locator(FADE_BOX).first()).toBeAttached()
    //PREMISE for every case: the target is the h-40 demo box, not the page
    expect(
      await page
        .locator(FADE_BOX)
        .first()
        .evaluate((el) => el.clientHeight),
      "the fade box selector must land on the 160px demo box",
    ).toBeLessThan(300)
  })

  test("scrollTo during a touch scroll: no error, the scroller ends inside its range, the fade strengths agree with the position", async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page)
    const box = page.locator(FADE_BOX).first()
    await box.evaluate((el) => {
      el.scrollTop = 0
    })
    const extent = await extentOf(box)
    expect(extent, "the fade box must overflow").toBeGreaterThan(100)
    const { point } = await aim(page, box, 0.75)

    await touch(cdp, "touchStart", point)
    await moves(cdp, point, 6, -20)
    await expect
      .poll(() => scrollTopOf(box), {
        message:
          "PREMISE: six moves up must scroll the box before anything changes under the finger",
      })
      .toBeGreaterThan(0)
    const midway = await scrollTopOf(box)
    await box.evaluate((el) => el.scrollTo({ top: 0 }))
    const afterJump = await scrollTopOf(box)
    await moves(cdp, point, 6, -20, -120)
    await touch(cdp, "touchEnd")

    const rest = await awaitStable(() => scrollTopOf(box), {
      message: "the box never settled after the gesture",
    })
    expect(
      errors,
      "no uncaught error from a scrollTo mid-gesture",
    ).toEqual([])
    expect(rest, "the scroller ends at or above 0").toBeGreaterThanOrEqual(
      0,
    )
    expect(
      rest,
      "the scroller ends at or below its extent",
    ).toBeLessThanOrEqual(extent)
    const expected = {
      start: Math.min(1, rest / RAMP_PX),
      end: Math.min(1, (extent - rest) / RAMP_PX),
    }
    let last = { start: Number.NaN, end: Number.NaN }
    //the poll returns a verdict STRING, so a timeout prints the numbers it read
    await expect
      .poll(
        async () => {
          last = await strengths(box)
          const agree =
            Math.abs(last.start - expected.start) <= 0.05 &&
            Math.abs(last.end - expected.end) <= 0.05
          return agree
            ? "agree"
            : `read start ${last.start} / end ${last.end}`
        },
        {
          message: `at rest scrollTop ${rest} (extent ${extent}) the strengths must be start ${expected.start.toFixed(3)} / end ${expected.end.toFixed(3)} ±0.05`,
        },
      )
      .toBe("agree")
    test.info().annotations.push({
      type: "measured",
      description: `scrollTop midway ${midway}, right after scrollTo(0) ${afterJump}, at rest ${rest} of ${extent}; strengths ${JSON.stringify(last)}`,
    })
  })

  test("scrollEnabled flipped off mid-drag stops the scroll and does not throw; flipped on, it scrolls again", async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page)
    const box = page.locator(VERTICAL)
    await box.evaluate((el) => {
      el.scrollTop = 0
    })
    const clickToggle = (state: "true" | "false") =>
      page.evaluate((text) => {
        const button = [...document.querySelectorAll("button")].find((b) =>
          (b.textContent ?? "").trim().startsWith(text),
        )
        if (!button) throw new Error(`no button "${text}"`)
        button.click()
      }, `scrollEnabled: ${state}`)

    const { point } = await aim(page, box)
    await touch(cdp, "touchStart", point)
    await moves(cdp, point, 4, -20)
    await expect
      .poll(() => scrollTopOf(box), {
        message:
          "PREMISE: four moves up must scroll the box before the flip",
      })
      .toBeGreaterThan(0)
    const atFlip = await scrollTopOf(box)
    await clickToggle("true")
    await expect(
      page.getByRole("button", { name: "scrollEnabled: false" }),
      "the toggle took",
    ).toBeVisible()
    await expect(box, "the prop landed as overflow-hidden").toHaveClass(
      /overflow-hidden/,
    )
    await moves(cdp, point, 6, -20, -80)
    await touch(cdp, "touchEnd")
    const afterFlip = await awaitStable(() => scrollTopOf(box), {
      message: "the box never settled after the flip",
    })
    expect(
      errors,
      "flipping scrollEnabled mid-drag must not throw",
    ).toEqual([])

    //a fresh drag while disabled must not scroll it further
    const disabledAim = await aim(page, box)
    await touch(cdp, "touchStart", disabledAim.point)
    await moves(cdp, disabledAim.point, 10, -20)
    await touch(cdp, "touchEnd")
    const disabledRest = await awaitStable(() => scrollTopOf(box), {
      message: "the box never settled after the disabled drag",
    })
    expect(
      disabledRest,
      `a disabled scroller must not scroll (was ${afterFlip} after the flip)`,
    ).toBeLessThanOrEqual(afterFlip + 1)

    //re-enable: a fresh drag scrolls again
    await clickToggle("false")
    await expect(
      page.getByRole("button", { name: "scrollEnabled: true" }),
    ).toBeVisible()
    await expect(box).toHaveClass(/overflow-y-auto/)
    const enabledAim = await aim(page, box)
    const enabledBefore = await scrollTopOf(box)
    await touch(cdp, "touchStart", enabledAim.point)
    await moves(cdp, enabledAim.point, 10, -20)
    await touch(cdp, "touchEnd")
    await expect
      .poll(() => scrollTopOf(box), {
        message: "re-enabled, a fresh drag must scroll the box again",
      })
      .toBeGreaterThan(enabledBefore)
    expect(errors).toEqual([])
    test.info().annotations.push({
      type: "measured",
      description: `scrollTop at the flip ${atFlip}, after the flipped drag ${afterFlip}, after a disabled drag ${disabledRest}, re-enabled ${enabledBefore} → ${await scrollTopOf(box)}`,
    })
  })

  test("font-size 200% keeps the fade depth and the scrollers working", async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page)
    const box = page.locator(FADE_BOX).first()
    const heightBefore = await box.evaluate((el) => el.clientHeight)
    const depthBefore = await box.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--fade-length").trim(),
    )
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%"
    })
    await expect
      .poll(() => box.evaluate((el) => el.clientHeight), {
        message:
          "PREMISE: the box's px height must follow the root font size",
      })
      .toBeGreaterThan(heightBefore * 1.8)
    await box.evaluate((el) => {
      el.scrollTop = 0
    })
    const extent = await extentOf(box)
    expect(extent, "the box must still overflow at 200%").toBeGreaterThan(
      50,
    )

    const { point } = await aim(page, box, 0.75)
    await touch(cdp, "touchStart", point)
    await moves(cdp, point, 8, -20)
    await touch(cdp, "touchEnd")
    const rest = await awaitStable(() => scrollTopOf(box), {
      message: "the box never settled",
    })
    expect(rest, "the box still scrolls by touch at 200%").toBeGreaterThan(
      0,
    )

    const style = await box.evaluate((el) => {
      const computed = getComputedStyle(el)
      return {
        mask: computed.maskImage || computed.webkitMaskImage,
        depth: computed.getPropertyValue("--fade-length").trim(),
      }
    })
    expect(style.mask, "the mask is still applied").not.toBe("none")
    expect(style.mask).toContain("gradient")
    expect(style.depth, "the fade depth is the prop's, unchanged").toBe(
      depthBefore,
    )
    await expect
      .poll(async () => (await strengths(box)).start, {
        message: "scrolled off the top, the start fade must be lit",
      })
      .toBeGreaterThan(0)
    expect(errors).toEqual([])
    test.info().annotations.push({
      type: "measured",
      description: `clientHeight ${heightBefore} → ${await box.evaluate((el) => el.clientHeight)}; depth ${depthBefore}; rest scrollTop ${rest} of ${extent}; mask ${style.mask.slice(0, 80)}`,
    })
  })

  test("the edge-fade hook coalesces its work per frame through a scroll burst and idles at rest", async ({
    page,
  }) => {
    const box = page.locator(FADE_BOX).first()
    await box.evaluate((el) => {
      el.scrollTop = 0
    })
    const { point } = await aim(page, box)
    await awaitStable(() => scrollTopOf(box), { message: "not at rest" })
    await box.evaluate((el) => {
      const w = window as Window & { __scrollEvents?: number }
      w.__scrollEvents = 0
      el.addEventListener("scroll", () => {
        w.__scrollEvents = (w.__scrollEvents ?? 0) + 1
      })
    })
    //the page must be idle BEFORE the burst, or the burst's count means nothing
    const baseline = await rafOverQuiet(page, 500)
    expect(
      baseline.ran + baseline.requested,
      `PREMISE: no rAF before the burst — callers: ${JSON.stringify(baseline.callers)}`,
    ).toBe(0)

    await resetRafCounters(page)
    await page.mouse.move(point.x, point.y)
    await page.mouse.wheel(0, 200)
    const rest = await awaitStable(() => scrollTopOf(box), {
      message: "the box never settled after the wheel",
    })
    expect(rest, "PREMISE: the wheel scrolled the box").toBeGreaterThan(0)
    const scrollEvents = await page.evaluate(
      () =>
        (window as Window & { __scrollEvents?: number }).__scrollEvents ??
        0,
    )
    const during = await readProbe(page)
    expect(
      during.rafRan,
      "PREMISE: the hook measured at least once during the burst",
    ).toBeGreaterThanOrEqual(1)
    expect(
      during.rafRan,
      `frames of work (${during.rafRan}) must not exceed the burst's scroll events (${scrollEvents}, plus the frame that opens the burst and the one that closes it) — a hook that measures per event, not per frame, runs more; callers ${JSON.stringify(during.rafCallers)}`,
    ).toBeLessThanOrEqual(scrollEvents + 2)

    const quiet = await rafOverQuiet(page, 1000)
    test.info().annotations.push({
      type: "measured",
      description: `burst: ${scrollEvents} scroll events, ${during.rafRequested} rAF requested, ${during.rafRan} ran (${JSON.stringify(during.rafCallers)}); quiet second: ${quiet.ran} ran / ${quiet.requested} requested; rest scrollTop ${rest}`,
    })
    expect(
      quiet.ran + quiet.requested,
      `rAF over 1s at rest must be 0 — callers: ${JSON.stringify(quiet.callers)}`,
    ).toBe(0)
    expect(errors).toEqual([])
  })
})
