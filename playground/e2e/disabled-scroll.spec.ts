import { expect, test } from "@playwright/test"

/*
 * Can you scroll the page with your finger on a DISABLED control?
 *
 * A disabled press target carries `touch-none`. That is what stops it being tapped
 * "no matter what className says" — but `touch-action: none` does not only block
 * activation, it blocks the browser from treating the gesture as a scroll at all. On a
 * form with a few disabled fields that turns them into dead zones: you put your thumb
 * down, swipe, and the page does not move.
 *
 * Measured before changing anything: the page moved 0px. `touch-none` was redundant
 * belt-and-braces — the engine already refuses every gesture when `disabled` and
 * `<button disabled>` already blocks native activation, and `touch-action` never
 * governed tappability in the first place — so it was pure cost. A disabled control now
 * carries the same pass-through as a live one, and this is the guard.
 *
 * ⚠︎ chromium-only (CDP touch), portrait viewport (a touch context at a landscape size
 * wakes the rotate guard, which covers the screen).
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

const TOLERANCE_PX = 8

test.describe("a disabled control", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "needs CDP touch injection",
  )

  test("does not become a dead zone for scrolling", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page)
    await page.goto("/lab/button")

    const disabled = page.getByRole("button", { name: /^disabled$/i })
    await disabled.waitFor()
    await disabled.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)

    //confirm it really is the disabled target before drawing any conclusion from it
    await expect(disabled).toBeDisabled()
    /*
     * `manipulation`, not `pan-x pan-y pinch-zoom` — Chrome CANONICALISES the longhand
     * on readback, so a computed `touch-action` cannot tell the two apart. That is
     * precisely why adaptv spells the longhand (WebKit 240917 stops firing
     * `pointercancel` under a literal `manipulation`) and why this check is only here to
     * rule out `none`. The gesture below is the honest test.
     */
    expect(
      await disabled.evaluate((el) => getComputedStyle(el).touchAction),
      "a disabled control must keep the touch pass-through, not `none`",
    ).not.toBe("none")

    const box = await disabled.boundingBox()
    if (!box) throw new Error("the disabled button has no layout box")
    const centre = {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    }
    const onTarget = await page.evaluate(
      ([x, y]) =>
        (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(
          "button[disabled]",
        ) !== null,
      [centre.x, centre.y],
    )
    expect(onTarget, "the touch point misses the disabled button").toBe(
      true,
    )

    const scroller = "[data-adaptv-screen] > *"
    const position = () =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el) return { top: window.scrollY, room: 0 }
        return {
          top: el.scrollTop,
          room: el.scrollHeight - el.clientHeight,
        }
      }, scroller)

    /*
     * Swipe toward whichever end has room. `scrollIntoViewIfNeeded` leaves this button
     * near the bottom of the page — it is in the last section — so a swipe "up" has
     * nowhere to go and reports 0 whether the dead zone exists or not. Choosing the
     * direction is what makes a 0 here mean something.
     */
    const { top: before, room } = await position()
    expect(
      room,
      "the page must be scrollable for this to test anything",
    ).toBeGreaterThan(100)
    const dy = before > room / 2 ? 9 : -9

    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [centre],
    })
    for (let step = 1; step <= 18; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: centre.x, y: centre.y + dy * step }],
      })
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    })
    await page.waitForTimeout(350)

    expect(
      Math.abs((await position()).top - before),
      "the page did not move — a disabled control is a scroll dead zone",
    ).toBeGreaterThan(TOLERANCE_PX)
  })
})
