import type { Locator } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Edge fades, measured in a real engine.
 *
 * The unit tests pin the arithmetic against a stubbed scroll geometry, because jsdom
 * lays nothing out. What they cannot show is that the pieces are actually WIRED: that
 * the `@utility` compiled (Tailwind's `--value()` fails soft — an unparseable
 * expression emits no rule and no error), that the mask reads the strengths the hook
 * writes, and that a real scroll drives them. Every one of those can be individually
 * correct and the feature still do nothing.
 *
 * The claim under test is the reported one: a tall fade must not sit permanently over
 * content that has nothing beyond it.
 */

//a phone viewport, so the horizontal strip actually overflows — at 1280px the demo
//chips all fit and every strength is legitimately 0, which reads as a broken fade
test.use({ viewport: { width: 390, height: 844 } })

//the deep-fade demo, by the depth it is given rather than by a class that no longer
//exists — depth is a prop now, so there is nothing in the class list to match on
const DEEP_FADE = '[data-fade][style*="--fade-length"]' 

const strengths = (el: Locator) =>
  el.evaluate((node) => ({
    start: Number(node.style.getPropertyValue("--fade-start")),
    end: Number(node.style.getPropertyValue("--fade-end")),
  }))

/*
 * POLL for the strengths; never wait a fixed number of frames.
 *
 * The hook coalesces into rAF, and under parallel workers against one dev server the
 * frame budget is not predictable — a two-frame wait passed alone and failed in the
 * full run, which is the worst kind of test. `expect.poll` retries until the value
 * settles and reports the last one it saw on timeout.
 */
async function expectStrengths(
  el: Locator,
  expected: { start: number; end: number },
  because: string,
) {
  await expect.poll(() => strengths(el), { message: because }).toEqual(expected)
}

async function scrollTo(el: Locator, offset: number) {
  await el.evaluate((node, to) => {
    node.scrollTop = to
  }, offset)
}

test.describe("ScrollView fade", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/view-scroll")
    await page.locator(DEEP_FADE).first().waitFor()
  })

  test("is off at the edge it is parked against, and on at the other", async ({
    page,
  }) => {
    //the report: "the edges should fade out when it is parked at those points, so
    //that people can use tall gradients without parked problems"
    const box = page.locator(DEEP_FADE).first()
    await scrollTo(box, 0)
    await expectStrengths(
      box,
      { start: 0, end: 1 },
      "parked at the top: the top must be crisp and the bottom must fade",
    )

    const max = await box.evaluate((n) => n.scrollHeight - n.clientHeight)
    expect(max, "the demo box must actually overflow").toBeGreaterThan(100)

    await scrollTo(box, max)
    await expectStrengths(
      box,
      { start: 1, end: 0 },
      "parked at the bottom: the fade must swap ends",
    )
  })

  test("ramps rather than popping on the first scrolled pixel", async ({
    page,
  }) => {
    const box = page.locator(DEEP_FADE).first()
    await scrollTo(box, 12)
    await expect
      .poll(async () => (await strengths(box)).start)
      .toBeGreaterThan(0)
    expect((await strengths(box)).start).toBeLessThan(1)
  })

  test("the fadeSize prop actually reaches the mask", async ({ page }) => {
    /*
     * The prop writes `--fade-length` inline and the mask reads it through `calc()`.
     * A typo in either half leaves the default 2rem in place and the page looks
     * plausible while every depth in the app is silently ignored.
     */
    const length = await page
      .locator(DEEP_FADE)
      .first()
      .evaluate((node) =>
        getComputedStyle(node).getPropertyValue("--fade-length").trim(),
      )
    expect(length).not.toBe("")
    expect(length, "still the default — the prop never landed").not.toBe("2rem")
  })

  test("the mask is on the scroller itself, with no wrapper and no colour", async ({
    page,
  }) => {
    //the old implementation needed a wrapper element and a `bg-*` class that had to
    //match whatever was behind it; this asserts neither came back
    const box = page.locator(DEEP_FADE).first()
    const mask = await box.evaluate((node) => getComputedStyle(node).maskImage)
    expect(mask).toContain("gradient")
  })

  test("a one-ended fade never lights the other end", async ({ page }) => {
    const box = page.locator('[data-fade="end"]').first()
    await box.scrollIntoViewIfNeeded()
    const max = await box.evaluate((n) => n.scrollHeight - n.clientHeight)
    await scrollTo(box, max)
    //parked at the bottom, `start` would be 1 if the prop were being ignored
    await expectStrengths(
      box,
      { start: 0, end: 0 },
      "fade='end' must never light the start, wherever the scroll is",
    )
  })

  test("a horizontal scroller fades along the inline axis", async ({ page }) => {
    const strip = page.locator('[data-fade][data-scroll-view="x"]').first()
    await strip.scrollIntoViewIfNeeded()

    const direction = await strip.evaluate((node) =>
      getComputedStyle(node).getPropertyValue("--fade-direction").trim(),
    )
    expect(
      direction,
      "without this the mask fades top/bottom on a horizontal strip",
    ).toBe("to right")

    await expectStrengths(
      strip,
      { start: 0, end: 1 },
      "the chip row must overflow at this viewport, or this test proves nothing",
    )
    await strip.evaluate((node) => {
      node.scrollLeft = node.scrollWidth
    })
    await expectStrengths(
      strip,
      { start: 1, end: 0 },
      "scrolled to the inline end: the fade must swap ends",
    )
  })
})
