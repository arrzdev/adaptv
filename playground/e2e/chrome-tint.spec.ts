import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * The browser-chrome tint — `<meta name="theme-color">` driven along a curve, and the drawer
 * consuming it so the toolbar dims WITH the scrim rather than after it.
 *
 * ⚠︎ What a browser test can and cannot see. The toolbar itself is painted by the browser
 * PROCESS and is not in the page, so Playwright can never read the pixel a user looks at. What it
 * can read is the tag, which is the only thing adaptv controls. So these tests assert the
 * contract at the DOM: the tag walks the curve, it lands exactly on the composite of the scrim
 * over the theme colour, and — the reason this file exists — it stays locked to the backdrop's
 * own opacity frame by frame.
 *
 * The pixel-level half of that claim is not testable here and was settled on a device instead:
 * a 60fps simulator capture with the toolbar and the scrim sampled from the SAME video frames.
 * `theme-color.ts` records the numbers and why the tween leads the curve by half a frame.
 * That lead is why the tolerance below is one-sided: the tag is allowed to run slightly AHEAD of
 * the scrim and is never allowed to trail it.
 */

test.use({ viewport: { width: 390, height: 844 } })

const META = "#theme-color-class-override"
const OVERLAY = "[data-pwa-drawer-overlay]"

/** The tag's current colour, which mid-transition is that frame's colour. */
async function tint(page: Page) {
  return page.locator(META).getAttribute("content")
}

/*
 * The splash is SSR-rendered and self-unmounts only once the client has hydrated, so its
 * disappearance is the one honest "React is driving now" signal on the page — the same handover
 * `drawer-motion.spec.ts` waits on. Without it a click lands on a button whose handler is not
 * attached yet, the transition never starts, and the test reads a tag nothing ever wrote and
 * blames the tween.
 */
async function awaitClientHandover(page: Page) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
}

/** The lab's curve and target controls are buttons; their labels also appear in rows. */
function control(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true })
}

test.describe("the generic hook", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/chrome-tint")
    await awaitClientHandover(page)
  })

  test("walks to the target along the curve, then lands on it exactly", async ({
    page,
  }) => {
    const base = await tint(page)
    expect(base).toBeTruthy()

    //the 2s curve is here so a transition can be caught mid-flight without racing it
    await control(page, "slow linear · 2s").click()
    await control(page, "→ #e60000").click()

    await page.waitForTimeout(300)
    const midway = await tint(page)
    expect(midway).not.toBe(base)
    expect(midway).not.toBe("#e60000")

    await expect.poll(() => tint(page), { timeout: 4000 }).toBe("#e60000")
  })

  test("hands the tag back to the theme colour on restore", async ({
    page,
  }) => {
    const base = await tint(page)
    await control(page, "sheet open · 0.38s").click()
    await control(page, "→ #0a0a0c").click()
    await expect.poll(() => tint(page), { timeout: 3000 }).toBe("#0a0a0c")

    await control(page, "restore").click()
    await expect.poll(() => tint(page), { timeout: 3000 }).toBe(base)
  })

  test("takes over from the colour on screen, with no jump at the seam", async ({
    page,
  }) => {
    await control(page, "slow linear · 2s").click()
    await control(page, "→ #0a0a0c").click()
    await page.waitForTimeout(600)
    const interrupted = await tint(page)

    await control(page, "→ #e60000").click()
    //one frame later it must still be next to where it was, not back at a start
    //it never had — the seam is a frame wide
    await page.waitForTimeout(50)
    const seam = await tint(page)
    const channel = (hex: string) => Number.parseInt(hex.slice(1, 3), 16)
    expect(
      Math.abs(
        channel(seam ?? "#000000") - channel(interrupted ?? "#000000"),
      ),
    ).toBeLessThan(24)

    await expect.poll(() => tint(page), { timeout: 4000 }).toBe("#e60000")
  })
})

test.describe("the drawer consuming it", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/drawer")
    await awaitClientHandover(page)
  })

  test("dims the tag to the scrim composited over the theme colour", async ({
    page,
  }) => {
    const base = await tint(page)
    await control(page, "Open basic drawer").click()
    await expect(page.locator(OVERLAY)).toBeVisible()

    await page.waitForTimeout(700)
    const dimmed = await tint(page)
    expect(dimmed).not.toBe(base)

    //the end colour is the composite the browser would paint, not an approximation:
    //the scrim's own colour and alpha laid over the base
    const expected = await page.evaluate(
      ([overlaySelector, baseColor]) => {
        const overlay = document.querySelector(
          overlaySelector as string,
        ) as HTMLElement
        const scrim = getComputedStyle(overlay).backgroundColor
        //let the engine do the compositing, then read the pixel back
        const probe = document.createElement("canvas")
        probe.width = probe.height = 1
        const ctx = probe.getContext("2d")
        if (!ctx) return null
        ctx.fillStyle = baseColor as string
        ctx.fillRect(0, 0, 1, 1)
        ctx.fillStyle = scrim
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
        return `#${[r, g, b]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("")}`
      },
      [OVERLAY, base],
    )

    if (expected) {
      const rgb = (hex: string) =>
        [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
      const a = rgb(dimmed ?? "#000000")
      const b = rgb(expected)
      //within a rounding step per channel — `oklch()` scrims round-trip through
      //two different code paths to get here
      for (let i = 0; i < 3; i += 1) {
        expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(2)
      }
    }
  })

  /*
   * THE regression this file was written for. The tint used to read as a second thing chasing
   * the backdrop rather than as part of the same motion. At the DOM the two must sit on one
   * curve — and specifically the tag may lead the scrim (it is written half a frame ahead on
   * purpose) and must never trail it.
   */
  test("stays locked to the backdrop's own opacity, frame by frame", async ({
    page,
    browserName,
  }) => {
    /*
     * ⚠︎ chromium-only, and the reason is measured rather than assumed. The two engines start a
     * CSS animation's clock differently: on the first frame that can observe the overlay's
     * animation, Chromium reports `currentTime` 0.0 and WebKit reports 17.0 — a whole frame of
     * head start the scrim gets and the rAF tween does not. So under WebKit this test reads a
     * ~one-frame trail that no user can see, and loosening the bound far enough to pass there
     * would let the real regression back through (it fails at only -0.069 on chromium).
     *
     * Safari is not going untested — it is tested where it counts. The painted-pixel version of
     * this ran on an iOS 18 simulator against a 60fps capture, which is what settled the half
     * frame in the first place; `theme-color.ts` records those numbers.
     */
    test.skip(
      browserName !== "chromium",
      "WebKit starts the animation clock a frame ahead of rAF; see the note above",
    )
    const samples = await page.evaluate(
      async ([metaSelector, overlaySelector]) => {
        const meta = document.querySelector(
          metaSelector as string,
        ) as HTMLMetaElement
        const start = meta.content
        const trigger = [...document.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "Open basic drawer",
        )
        const out: { opacity: number; tint: string; at: number }[] = []
        let stop = false
        function frame() {
          const overlay = document.querySelector(
            overlaySelector as string,
          ) as HTMLElement | null
          if (overlay) {
            out.push({
              opacity: Number(getComputedStyle(overlay).opacity),
              tint: meta.content,
              //when the main thread actually got this frame — the cadence check below
              at: performance.now(),
            })
          }
          if (!stop) requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
        trigger?.click()
        await new Promise((r) => setTimeout(r, 800))
        stop = true
        return { start, out }
      },
      [META, OVERLAY],
    )

    const rgb = (hex: string) =>
      [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
    const usable = samples.out.filter((s) =>
      /^#[0-9a-f]{6}$/i.test(s.tint),
    )
    expect(usable.length).toBeGreaterThan(10)

    const from = rgb(samples.start)
    const to = rgb(usable[usable.length - 1].tint)
    //the channel that actually travelled — the theme colour is not always grey
    const ch = [0, 1, 2].reduce(
      (best, i) =>
        Math.abs(to[i] - from[i]) > Math.abs(to[best] - from[best])
          ? i
          : best,
      0,
    )
    const travel = to[ch] - from[ch]
    expect(Math.abs(travel)).toBeGreaterThan(8)

    /*
     * Read over the frames where the backdrop is ACTUALLY moving — the plateau at either end is
     * offset 0 by construction and would drown the statistic — and at the lower quartile rather
     * than at the single worst frame. That second choice is measured, not stylistic. Five runs
     * each, with the lead and with it taken back out:
     *
     *              worst frame        lower quartile
     *   no lead    -0.042 … -0.092    -0.023 … -0.054
     *   lead       -0.019 … +0.001    -0.007 … +0.006
     *
     * The worst frame OVERLAPS: one stalled frame reaches -0.04 whether the fix is in or not,
     * which is exactly what made this test fail about one run in three when it shared a machine
     * with the drawer suite. The quartile leaves 0.016 of empty space between the two, and the
     * bound below sits in the middle of that gap with room on both sides.
     */
    /*
     * WHAT THIS MEASUREMENT NEEDS, stated rather than assumed. The two things compared are not
     * symmetric: the scrim is a CSS animation the compositor keeps time for, and the tint is a
     * rAF tween on the main thread. Starve the main thread and only one of them slips — so on a
     * machine that cannot hit a frame rate, this test reads a trail that says nothing about the
     * code. It happened here: a simulator left booted crash-looping an internal extension took
     * the load average to 8.5, the suite from 23s to 8.9 MINUTES, and this assertion to -0.030,
     * squarely inside the range the regression produces. The lead cannot rescue that by design
     * — it is capped at one frame precisely so a stall does not fling the tint ahead of the page.
     *
     * So the environment is asserted first, and fails in its own words. It is a precondition,
     * not an escape hatch: when the cadence is sane the offset assertion runs exactly as before.
     */
    const cadence = usable
      .slice(1)
      .map((s, i) => s.at - usable[i].at)
      .sort((a, b) => a - b)
    const medianFrame = cadence[Math.floor(cadence.length / 2)]
    expect(
      medianFrame,
      `the page never reached a usable frame rate (median frame ${medianFrame?.toFixed(1)}ms), so the tint could not be timed against the scrim — this is the machine, not the code`,
    ).toBeLessThan(32)

    const offsets = usable
      .filter((s) => s.opacity > 0.02 && s.opacity < 0.98)
      .map((s) => (rgb(s.tint)[ch] - from[ch]) / travel - s.opacity)
      .sort((a, b) => a - b)
    expect(offsets.length).toBeGreaterThan(10)

    const trail = offsets[Math.floor(offsets.length * 0.25)]
    const worstLead = offsets[offsets.length - 1]

    //deliberately asymmetric: leading is the fix, trailing is the bug
    expect(trail).toBeGreaterThan(-0.015)
    expect(worstLead).toBeLessThan(0.16)
  })

  test("gives the tag back when the sheet closes", async ({ page }) => {
    const base = await tint(page)
    await control(page, "Open basic drawer").click()
    await expect(page.locator(OVERLAY)).toBeVisible()
    await expect.poll(() => tint(page), { timeout: 2000 }).not.toBe(base)

    await control(page, "Close").click()
    await expect(page.locator(OVERLAY)).toBeHidden()
    await expect.poll(() => tint(page), { timeout: 2000 }).toBe(base)
  })
})
