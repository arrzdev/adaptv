import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Button's width tween, sampled frame by frame.
 *
 * When a slot or the label changes, Button's content row animates to its newly
 * measured width instead of snapping. Nothing about a snap is visible to an
 * assertion on the END state: the label is right and the width is right. So the
 * only honest check is the frames in between: from the press on, the row must be
 * seen at widths strictly between where it started and where it lands.
 *
 * `offsetWidth`, not the bounding box: the press itself scales the button
 * (`active:scale-95`), and a scaled box reads as intermediate widths with no
 * tween at all. (`docs/decisions/animation.md` §3.1)
 *
 * Runs on both engines; a mouse click activates Button on chromium and webkit
 * alike (the Offline spec relies on the same).
 */

const SAMPLE_MS = 900
//the tween is 200ms and may start up to ~210ms after the press on a loaded
//runner; every frame from here to the end of the window must show the row landed
const SETTLED_MS = 600

type TweenWindow = {
  __tween: {
    pressedAt: number | null
    before: number[]
    after: number[]
    at: number[]
  }
}

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

    //sample the content row (the button's only child) on every frame, from
    //before the press until the label has had well over the 200ms tween to land
    await button.evaluate((el, sampleMs) => {
      const row = el.firstElementChild as HTMLElement
      const w = window as unknown as TweenWindow
      w.__tween = { pressedAt: null, before: [], after: [], at: [] }
      const tween = w.__tween
      el.addEventListener(
        "pointerdown",
        () => {
          tween.pressedAt = performance.now()
        },
        { capture: true, once: true },
      )
      const tick = () => {
        const now = performance.now()
        const { pressedAt } = tween
        if (pressedAt === null) tween.before.push(row.offsetWidth)
        else {
          tween.after.push(row.offsetWidth)
          tween.at.push(Math.round(now - pressedAt))
        }
        if (pressedAt === null || now < pressedAt + sampleMs)
          requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, SAMPLE_MS)

    await page.waitForFunction(
      () => (window as unknown as TweenWindow).__tween.before.length >= 2,
    )
    await button.click()
    await expect(button).toHaveText(/Working/)
    await page.waitForFunction((sampleMs) => {
      const { pressedAt } = (window as unknown as TweenWindow).__tween
      return pressedAt !== null && performance.now() > pressedAt + sampleMs
    }, SAMPLE_MS)

    const { before, after, at } = await page.evaluate(
      () => (window as unknown as TweenWindow).__tween,
    )
    const samples = after
    const from = before[before.length - 1]
    const to = samples[samples.length - 1]
    const seen = `(widths ${samples.join(", ")}; ms after press ${at.join(", ")})`

    //the premise: the label change really does move the row, by a lot
    expect(
      from - to,
      `the row must shrink from "run a pending cycle" to "Working…" ${seen}`,
    ).toBeGreaterThan(20)

    const between = samples.filter((w) => w < from - 1 && w > to + 1)
    expect(
      between.length,
      `the row must pass through an intermediate width, not jump ${seen}`,
    ).toBeGreaterThanOrEqual(1)

    //no bounce and no two-step that grows back: every frame is at or past the last
    const backward = samples.findIndex(
      (w, i) => w > (i === 0 ? from : samples[i - 1]),
    )
    expect(
      backward,
      `the row must only move from ${from} toward ${to} ${seen}`,
    ).toBe(-1)

    //sampling stops on the first frame past SAMPLE_MS, so the tail is never empty
    const tail = samples.filter((_, i) => at[i] >= SETTLED_MS)
    expect(
      tail.every((w) => w === to),
      `the row must have settled at ${to} by ${SETTLED_MS}ms ${seen}`,
    ).toBe(true)
  })
})
