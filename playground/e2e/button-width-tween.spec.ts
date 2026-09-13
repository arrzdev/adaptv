import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Button's width tween, sampled frame by frame.
 *
 * When a slot or the label changes, Button's content row animates to its newly
 * measured width instead of snapping. The row is a motion `m.span`, and `m` is
 * the half of motion that renders but does not animate on its own: it needs a
 * `LazyMotion` provider to hand it the animation feature
 * (`docs/decisions/animation.md` A7). An `m` that finds no provider renders the
 * same element with the same props and simply jumps to the new width. Nothing
 * throws, the label is right, and an assertion on the END width passes. So the
 * only honest check is the frames in between: the row must be seen at widths
 * strictly between where it started and where it lands.
 *
 * Runs on both engines; a mouse click activates Button on chromium and webkit
 * alike (the Offline spec relies on the same).
 */

const SAMPLE_MS = 900

test.describe("Button width tween", () => {
  test("the content row tweens to a new label's width instead of snapping", async ({
    page,
  }) => {
    await page.goto("/lab/button")
    await awaitClientHandover(page)

    //pinned by an attribute of our own: the accessible name is the label, and
    //the label is exactly what this test changes
    await page
      .getByRole("button", { name: /run a pending cycle/i })
      .evaluate((el) => el.setAttribute("data-e2e-tween", ""))
    const button = page.locator("[data-e2e-tween]")
    await button.scrollIntoViewIfNeeded()

    //sample the content row (the button's only child) on every frame, from just
    //before the click until the label has had well over the 200ms tween to land
    await button.evaluate((el, sampleMs) => {
      const row = el.firstElementChild as HTMLElement
      const samples: number[] = []
      const w = window as unknown as { __tweenSamples: number[] }
      w.__tweenSamples = samples
      let until = Number.POSITIVE_INFINITY
      const tick = () => {
        samples.push(row.getBoundingClientRect().width)
        if (samples.length === 2) until = performance.now() + sampleMs
        if (performance.now() < until) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, SAMPLE_MS)

    await page.waitForFunction(
      () =>
        (window as unknown as { __tweenSamples: number[] }).__tweenSamples
          .length >= 2,
    )
    await button.click()
    await expect(button).toHaveText(/Working/)
    await page.waitForTimeout(SAMPLE_MS + 100)

    const samples = await page.evaluate(
      () =>
        (window as unknown as { __tweenSamples: number[] }).__tweenSamples,
    )
    const from = samples[0]
    const to = samples[samples.length - 1]

    //the premise: the label change really does move the row, by a lot
    expect(
      from - to,
      `the row must shrink from "run a pending cycle" to "Working…" (samples ${samples.join(", ")})`,
    ).toBeGreaterThan(20)

    const between = samples.filter((w) => w < from - 1 && w > to + 1)
    expect(
      between.length,
      `the row must pass through intermediate widths, not jump (samples ${samples.join(", ")})`,
    ).toBeGreaterThanOrEqual(3)
  })
})
