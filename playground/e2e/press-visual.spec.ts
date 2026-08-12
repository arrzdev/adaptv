import type { CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * The press visual, measured against real touch.
 *
 * Reported: "if I just layed the finger down and swiped, not even the pressed style
 * should be activated". The old engine stamped `data-pressed` on `pointerdown`, so
 * every scroll that happened to begin on a control flashed it for the frames before
 * the browser fired `pointercancel`. The engine now DEFERS the visual past that
 * window (100ms) and floors it once shown (150ms) — Ionic's `tap-click` pair, see
 * PRIOR-ART.md §6.
 *
 * The unit tests pin the timers deterministically. What they CANNOT show is whether
 * the browser cancels the pointer inside that window, because synthetic events never
 * drive native scrolling — and that arbitration is the whole subject. So this file
 * drives real touch and samples the attribute WHILE the finger moves; a check after
 * the fact would pass even on an engine that flashed, because the flash is gone.
 *
 * ⚠︎ chromium-only (CDP). That is the Android WebView engine, so it is a real target,
 * but a pass here is NOT evidence for WKWebView. iOS stays a manual check.
 */

//`hasTouch` on the CONTEXT, not `Emulation.setTouchEmulationEnabled` bolted on after
//the fact. With emulation enabled late, touch pointer events reach native listeners
//but never reach React's root — so every gesture read as a dead press engine, and the
//no-flash assertion would have "passed" without running a line of adaptv code.
test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

const BUTTON_NAME = /press, drag off, release/i

/** Poll the flag from the page while the gesture runs — a flash is only visible live. */
async function watchPressed(page: Page) {
  await page.evaluate(() => {
    const el = document
      .evaluate(
        "//button[contains(., 'press, drag off, release')]",
        document,
        null,
        9,
        null,
      )
      .singleNodeValue as HTMLElement | null
    const w = window as unknown as { __sawPressed?: boolean }
    w.__sawPressed = false
    const tick = () => {
      if (el?.hasAttribute("data-pressed")) w.__sawPressed = true
      requestAnimationFrame(tick)
    }
    tick()
  })
}

const sawPressed = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __sawPressed?: boolean }).__sawPressed === true,
  )

async function touch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  point?: { x: number; y: number },
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: point ? [point] : [],
  })
}

test.describe("press visual vs. a scroll that starts on a control", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "needs CDP touch injection — synthetic events do not drive native scrolling",
  )

  async function setup(page: Page) {
    const cdp = await page.context().newCDPSession(page)
    await page.goto("/lab/button")
    const button = page.getByRole("button", { name: BUTTON_NAME })
    await button.waitFor()
    await button.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)

    /*
     * Re-measure before EVERY gesture, and check the aim.
     *
     * `boundingBox()` is viewport-relative, this page scrolls inside an adaptv
     * ScrollView, and the layout moves between gestures (the log mounts on the first
     * committed press). CDP input has no actionability check, so a stale box lands on
     * empty space and every assertion then fails exactly like a dead press engine —
     * indistinguishable, and the reason this suite once looked like an adaptv bug.
     */
    const aim = async () => {
      const box = await button.boundingBox()
      if (!box) throw new Error("the button has no layout box")
      const point = {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
      }
      const onTarget = await page.evaluate(
        ([x, y]) => !!document.elementFromPoint(x, y)?.closest("button"),
        [point.x, point.y],
      )
      if (!onTarget) {
        throw new Error(
          `touch point ${point.x},${point.y} misses the button — the measurement ` +
            "is stale, not the engine",
        )
      }
      return point
    }

    /*
     * Warm up until the engine demonstrably responds, rather than sleeping a guessed
     * number of milliseconds. The FIRST synthetic gesture on a freshly loaded page is
     * swallowed in this harness — reproducibly, with raw mouse input too, and no
     * application code can suppress a native listener. Pressing until `data-pressed`
     * actually appears is a positive signal that input is landing, and it fails loudly
     * if it never does rather than leaving a green vacuous suite behind.
     */
    let live = false
    for (let attempt = 0; attempt < 6 && !live; attempt += 1) {
      const point = await aim()
      await touch(cdp, "touchStart", point)
      await page.waitForTimeout(160)
      live = await button.evaluate((el) => el.hasAttribute("data-pressed"))
      await touch(cdp, "touchEnd")
      await page.waitForTimeout(300)
    }
    if (!live) {
      throw new Error(
        "the press engine never responded to touch — input is not reaching the page",
      )
    }

    /*
     * Then let the page go QUIET before the measured gesture, and prove it did.
     *
     * The warm-up commits a press, which mounts the log and re-renders. Chromium will
     * not turn a touch into a scroll until it has pushed a fresh touch-action region
     * to the compositor; a gesture issued inside that window is handled on the main
     * thread instead, so the container never scrolls, `pointercancel` never arrives,
     * and the press legitimately commits. That is indistinguishable from an engine
     * that failed to defer — it fails on the assertion below with "the visual is not
     * deferred" while the engine is in fact perfect. Measured: the warm-up's own
     * 300ms is not enough on a loaded machine; the gesture is only arbitrated again
     * once the page has been idle for ~1s.
     *
     * So rather than sleep a guessed number, wait for real idle frames — and make the
     * premise assertable instead of assumed (`cancelled` below).
     */
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let idleFrames = 0
          let last = performance.now()
          const tick = () => {
            const now = performance.now()
            //a frame that arrived on time means nothing else is fighting for the
            //main thread; 60 of them in a row is a settled page
            idleFrames = now - last < 24 ? idleFrames + 1 : 0
            last = now
            if (idleFrames >= 60) resolve()
            else requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        }),
    )

    return { cdp, button, aim }
  }

  /**
   * Record whether the browser CLAIMED the gesture (fired `pointercancel`).
   *
   * The whole suite rests on that arbitration happening. When it does not, every
   * assertion here fails in a way that accuses the engine, so the premise has to be
   * checked explicitly — a harness that stopped reproducing a scroll must say so.
   */
  async function watchCancel(page: Page) {
    await page.evaluate(() => {
      const el = document
        .evaluate(
          "//button[contains(., 'press, drag off, release')]",
          document,
          null,
          9,
          null,
        )
        .singleNodeValue as HTMLElement | null
      const w = window as unknown as { __cancelled?: boolean }
      w.__cancelled = false
      el?.addEventListener("pointercancel", () => {
        w.__cancelled = true
      })
    })
  }

  const sawCancel = (page: Page) =>
    page.evaluate(
      () => (window as unknown as { __cancelled?: boolean }).__cancelled === true,
    )

  test("a finger laid down and swiped never lights the button", async ({
    page,
  }) => {
    const { cdp, aim } = await setup(page)
    const centre = await aim()
    await watchPressed(page)
    await watchCancel(page)

    await touch(cdp, "touchStart", centre)
    //move immediately and keep moving: this is the gesture the user described, and
    //it is the one the browser resolves into a page scroll
    for (let step = 1; step <= 16; step += 1) {
      await touch(cdp, "touchMove", { x: centre.x, y: centre.y - step * 9 })
    }
    await touch(cdp, "touchEnd")
    await page.waitForTimeout(300)

    //premise first: if the browser did not claim the gesture there was no scroll to
    //defer past, and the assertion below would blame the engine for the harness
    expect(
      await sawCancel(page),
      "the browser never claimed the swipe as a scroll — the harness stopped " +
        "reproducing the gesture under test, so this says nothing about the engine",
    ).toBe(true)

    expect(
      await sawPressed(page),
      "the swipe flashed the press style — the visual is not deferred",
    ).toBe(false)
  })

  test("a real tap does light it, and stays up long enough to see", async ({
    page,
  }) => {
    //the other half: deferring must not cost the feedback. A tap held past the defer
    //shows, and the floor keeps it on screen after the finger is already gone.
    const { cdp, button, aim } = await setup(page)
    const centre = await aim()

    await touch(cdp, "touchStart", centre)
    await page.waitForTimeout(140)
    await expect(button).toHaveAttribute("data-pressed", "")

    await touch(cdp, "touchEnd")
    expect(
      await button.evaluate((el) => el.hasAttribute("data-pressed")),
      "released right after showing — the minimum-duration floor must hold it",
    ).toBe(true)

    await page.waitForTimeout(400)
    expect(await button.evaluate((el) => el.hasAttribute("data-pressed"))).toBe(
      false,
    )
  })

  test("a drag the browser claims as a scroll never activates the button", async ({
    page,
  }) => {
    /*
     * This is the honest shape of "drag off and come back", and it is NOT iOS's.
     *
     * The engine tracks re-entry — leave the press region, come back, release, and it
     * still commits (unit-tested in use-gesture-engine.test.ts). On the web that path
     * is reachable by mouse and stylus, and on a NON-scrolling surface by touch. On a
     * scrolling page it is not reachable by touch at all: the browser claims the
     * gesture at its own touch slop (~10px) — far inside Button's 48px press outset —
     * and fires `pointercancel`. Nothing in JS can take it back; only
     * `touch-action: none` would, and that trades away the ability to scroll by
     * starting a drag on a button, which is far worse.
     *
     * So the guarantee worth pinning is the one that actually protects the user: a
     * gesture the platform turned into a scroll must leave no press behind and must
     * NOT activate. That is what this asserts.
     */
    const { cdp, button, aim } = await setup(page)
    const centre = await aim()
    const clicks = page.locator("[data-lab-log] li")
    const before = await clicks.count()
    await watchCancel(page)

    await touch(cdp, "touchStart", centre)
    await page.waitForTimeout(140)
    for (const dx of [20, 45, 70, 95]) {
      await touch(cdp, "touchMove", { x: centre.x + dx, y: centre.y })
    }
    await page.waitForTimeout(60)
    for (const dx of [70, 45, 20, 0]) {
      await touch(cdp, "touchMove", { x: centre.x + dx, y: centre.y })
    }
    await page.waitForTimeout(60)
    await touch(cdp, "touchEnd")
    await page.waitForTimeout(400)

    //same premise check: "cancelled" is the subject, so prove it was cancelled
    expect(
      await sawCancel(page),
      "the browser never claimed the drag as a scroll — the harness stopped " +
        "reproducing the gesture under test, so this says nothing about the engine",
    ).toBe(true)

    expect(
      await clicks.count(),
      "a cancelled gesture must not activate, even released back on the control",
    ).toBe(before)
    expect(
      await button.evaluate((el) => el.hasAttribute("data-pressed")),
      "and it must not leave the press visual stuck on",
    ).toBe(false)
  })
})
