import type { CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The press engine under stress — Button, Pressable, Link and Fab, which all ride
 * `useGestureEngine`. The existing specs prove each contract once; this file
 * proves it holds when the input is hostile: a tap faster than the engine's own
 * 100ms show-delay, twenty taps in half a second, a keyboard activation racing a
 * held pointer, a control disabled or unmounted while the finger is still on it,
 * fifty label flips retargeting a width tween mid-flight, a hold that spans a
 * viewport swap, a double-tap on a navigating link, and a swipe from a control
 * with the CPU throttled four times.
 *
 * Every test asserts its PREMISE before its verdict — the taps landed (the lab
 * log grew by exactly N), the flip counter reads 50, the browser really claimed
 * the swipe (`pointercancel`) — so a harness that stopped reproducing the input
 * fails on the premise line instead of passing vacuously. No retries, no warm-ups,
 * and the hydration gate (`awaitClientHandover`) in every beforeEach: a lab page is
 * server-rendered, so a gesture fired before React attaches is simply dropped.
 *
 * Touch scenarios are CDP (`Input.dispatchTouchEvent`) on chromium only — the
 * Android WebView engine — with `hasTouch` on the CONTEXT and a portrait viewport,
 * because a landscape touch context raises the playground's rotate guard over the
 * page. Mouse and keyboard scenarios run on both engines: a mouse press drives the
 * engine on chromium and webkit alike (press-states.spec.ts relies on the same).
 * The moved-and-held cases on a real finger stay on the simulator.
 */

const ENGINE_BUTTON = /press, drag off, release/i

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

/** Wait for 60 consecutive on-time frames — the page has gone quiet. */
async function awaitIdleFrames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let idleFrames = 0
        let last = performance.now()
        const tick = () => {
          const now = performance.now()
          idleFrames = now - last < 24 ? idleFrames + 1 : 0
          last = now
          if (idleFrames >= 60) resolve()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )
}

/**
 * The button's centre, re-measured and checked against `elementFromPoint`: the
 * lab page scrolls inside a ScrollView and the log mounts on the first commit, so
 * a stale box lands on empty space and reads exactly like a dead engine.
 */
async function aimAt(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name })
  await button.scrollIntoViewIfNeeded()
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
      `point ${point.x},${point.y} misses the button — the measurement is stale, not the engine`,
    )
  }
  return { button, point }
}

const logCount = (page: Page) => page.locator("[data-lab-log] li").count()

const hasPressed = (page: Page, name: RegExp) =>
  page
    .getByRole("button", { name })
    .evaluate((el) => el.hasAttribute("data-pressed"))

test.describe("press engine under touch stress (chromium, CDP)", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  })
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "CDP touch injection — synthetic events do not drive the engine's touch path",
  )

  async function setup(page: Page) {
    const cdp = await page.context().newCDPSession(page)
    await page.goto("/lab/button")
    await awaitClientHandover(page)
    await page.getByRole("button", { name: ENGINE_BUTTON }).waitFor()
    await awaitIdleFrames(page)
    return cdp
  }

  test("a tap whose finger lifts before the 100ms show-delay is still painted, for the floor", async ({
    page,
  }) => {
    const cdp = await setup(page)
    const { point } = await aimAt(page, ENGINE_BUTTON)
    const before = await logCount(page)

    const started = Date.now()
    await touch(cdp, "touchStart", point)
    await touch(cdp, "touchEnd")
    const contactMs = Date.now() - started
    //read the flag on the very next round trip, not through a poll whose first
    //interval is longer than the floor it measures
    const paintedOnRelease = await hasPressed(page, ENGINE_BUTTON)

    //premise: the tap was faster than the defer, and it activated
    expect(
      contactMs,
      "the harness must lift the finger inside the show-delay for this to test anything",
    ).toBeLessThan(90)
    await expect.poll(() => logCount(page)).toBe(before + 1)

    expect(
      paintedOnRelease,
      "a tap that commits before the defer must be painted on release — the most " +
        "common tap in the app otherwise gets no press feedback at all",
    ).toBe(true)
    //and the floor lets go of it
    await expect
      .poll(() => hasPressed(page, ENGINE_BUTTON), { timeout: 2000 })
      .toBe(false)
  })

  test("twenty taps in half a second all activate and leave the control at rest", async ({
    page,
  }) => {
    const cdp = await setup(page)
    const { button, point } = await aimAt(page, ENGINE_BUTTON)
    const before = await logCount(page)
    //the premise is read where it matters, in the page: the releases the engine
    //saw, timed by the page's own clock. A wall-clock bound on the driver loop
    //measured the machine (two CDP round trips per tap under load) and not the
    //mash, and failed at 902 ms against 900 on a loaded host
    await button.evaluate((el) => {
      const w = window as unknown as { __releases?: number[] }
      w.__releases = []
      el.addEventListener("pointerup", () => {
        w.__releases?.push(performance.now())
      })
    })

    for (let i = 0; i < 20; i += 1) {
      await touch(cdp, "touchStart", point)
      await touch(cdp, "touchEnd")
      await page.waitForTimeout(15)
    }
    const gaps = await page.evaluate(() => {
      const t = (window as unknown as { __releases?: number[] }).__releases
      if (!t) throw new Error("the release listener is gone")
      return t.slice(1).map((v, i) => v - (t[i] ?? v))
    })
    expect(
      gaps.length,
      "premise: twenty releases reached the engine",
    ).toBe(19)
    const sorted = [...gaps].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
    test.info().annotations.push({
      type: "mash-gaps",
      description: `median ${median.toFixed(1)} ms, max ${sorted.at(-1)?.toFixed(1)} ms between releases`,
    })
    //a mash is taps that arrive faster than the press visual's own 100 ms
    //show-delay: each release lands while the previous press is still deferred
    expect(
      median,
      "the mash must be a mash: releases closer than the 100 ms show-delay",
    ).toBeLessThan(100)

    await expect.poll(() => logCount(page)).toBe(before + 20)
    await expect
      .poll(() => hasPressed(page, ENGINE_BUTTON), { timeout: 2000 })
      .toBe(false)
    await expect(button).not.toHaveAttribute("aria-disabled")
    await expect(button).toHaveAttribute("data-press-engine", "")
  })

  test("with the CPU throttled 4x a swipe from the control is still cancelled and never lights it", async ({
    page,
  }) => {
    const cdp = await setup(page)
    const { point } = await aimAt(page, ENGINE_BUTTON)
    await page.evaluate(() => {
      const el = document.evaluate(
        "//button[contains(., 'press, drag off, release')]",
        document,
        null,
        9,
        null,
      ).singleNodeValue as HTMLElement | null
      const w = window as unknown as {
        __sawPressed?: boolean
        __cancelled?: boolean
      }
      w.__sawPressed = false
      w.__cancelled = false
      el?.addEventListener("pointercancel", () => {
        w.__cancelled = true
      })
      const tick = () => {
        if (el?.hasAttribute("data-pressed")) w.__sawPressed = true
        requestAnimationFrame(tick)
      }
      tick()
    })

    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
    try {
      await touch(cdp, "touchStart", point)
      for (let step = 1; step <= 16; step += 1) {
        await touch(cdp, "touchMove", {
          x: point.x,
          y: point.y - step * 9,
        })
      }
      await touch(cdp, "touchEnd")
      await page.waitForTimeout(400)
    } finally {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
    }

    const { sawPressed, cancelled } = await page.evaluate(() => {
      const w = window as unknown as {
        __sawPressed?: boolean
        __cancelled?: boolean
      }
      return { sawPressed: w.__sawPressed, cancelled: w.__cancelled }
    })
    expect(
      cancelled,
      "the browser never claimed the swipe as a scroll under throttle — the harness " +
        "stopped reproducing the gesture, so this says nothing about the engine",
    ).toBe(true)
    expect(
      sawPressed,
      "under a slow main thread the swipe flashed the press style",
    ).toBe(false)
  })
})

test.describe("press engine under pointer and keyboard stress (both engines)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/button")
    await awaitClientHandover(page)
    await page.getByRole("button", { name: ENGINE_BUTTON }).waitFor()
  })

  test("twenty mouse presses in a burst activate twenty times", async ({
    page,
  }) => {
    const { button, point } = await aimAt(page, ENGINE_BUTTON)
    const before = await logCount(page)
    await page.mouse.move(point.x, point.y)
    for (let i = 0; i < 20; i += 1) {
      await page.mouse.down()
      await page.mouse.up()
    }
    await expect.poll(() => logCount(page)).toBe(before + 20)
    await expect
      .poll(() => hasPressed(page, ENGINE_BUTTON), { timeout: 2000 })
      .toBe(false)
    await expect(button).not.toHaveAttribute("aria-disabled")
  })

  test("a keyboard activation racing a held pointer activates exactly once", async ({
    page,
  }) => {
    //Enter lands while the mouse is still down: the key press resets the engine
    //and owns the activation, and the mouse release that follows must not add a
    //second one (its trailing click arrives unowned and is swallowed)
    const { button, point } = await aimAt(page, ENGINE_BUTTON)
    const before = await logCount(page)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    //WebKit blurs a button on mousedown; focus it explicitly with the mouse held
    await button.focus()
    await expect(button).toBeFocused()
    await page.keyboard.press("Enter")
    await page.mouse.up()
    //let any second activation land before counting — a poll that reads the
    //first one would pass before the bug shows
    await page.waitForTimeout(300)
    expect(await logCount(page)).toBe(before + 1)
    await expect
      .poll(() => hasPressed(page, ENGINE_BUTTON), { timeout: 2000 })
      .toBe(false)
  })

  test("fifty label flips at twenty a second land on the label's own width", async ({
    page,
  }) => {
    const button = page.getByTestId("button-label-flip")
    const flips = page.getByTestId("button-label-flips")
    await button.scrollIntoViewIfNeeded()
    await expect(flips).toHaveText("0")
    //the left edge is stable across widths, the centre is not; and mouse.click
    //has no actionability wait, so it lands MID-tween where locator.click would
    //wait for the box to stop moving
    const box = await button.boundingBox()
    if (!box) throw new Error("the flip button has no box")
    const x = box.x + 12
    const y = box.y + box.height / 2
    for (let i = 0; i < 50; i += 1) {
      await page.mouse.click(x, y)
      await page.waitForTimeout(20)
    }
    //premise: every press landed and flipped the label
    await expect(flips).toHaveText("50")

    //the row must settle on exactly the width its content measures
    await expect
      .poll(
        () =>
          button.evaluate((el) => {
            const shell = el.firstElementChild as HTMLElement
            const measure = shell.firstElementChild as HTMLElement
            return Math.abs(
              shell.getBoundingClientRect().width - measure.scrollWidth,
            )
          }),
        { timeout: 2000 },
      )
      .toBeLessThanOrEqual(1)
    await expect(button).toHaveText(/a medium one/)
  })

  test("under reduced motion the width snaps, and no frame is seen in between", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.reload()
    await awaitClientHandover(page)
    const button = page.getByTestId("button-label-flip")
    await button.scrollIntoViewIfNeeded()
    //reduced motion renders the measure row alone: the first child is not the
    //overflow-hidden motion shell and carries no inline width (its own children
    //are the slots, so "no nested element" is not the premise — "no shell" is)
    expect(
      await button.evaluate((el) => {
        const first = el.firstElementChild as HTMLElement
        return {
          shell: first.classList.contains("overflow-hidden"),
          width: first.style.width,
        }
      }),
    ).toEqual({ shell: false, width: "" })

    await button.evaluate((el) => {
      const row = el.firstElementChild as HTMLElement
      const w = window as unknown as { __rm: number[] }
      w.__rm = []
      const until = performance.now() + 400
      const tick = () => {
        w.__rm.push(row.offsetWidth)
        if (performance.now() < until) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const before = await button.evaluate(
      (el) => (el.firstElementChild as HTMLElement).offsetWidth,
    )
    await button.click()
    await expect(page.getByTestId("button-label-flips")).toHaveText("1")
    await page.waitForTimeout(450)
    const samples = await page.evaluate(
      () => (window as unknown as { __rm: number[] }).__rm,
    )
    const after = samples[samples.length - 1]
    expect(after, "the label change must move the row").not.toBe(before)
    const between = samples.filter((w) => w !== before && w !== after)
    expect(
      between,
      `reduced motion must snap, never tween (samples ${samples.join(", ")})`,
    ).toEqual([])
  })
})

test.describe("a press that outlives its control (both engines)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/pressable")
    await awaitClientHandover(page)
    await page.getByTestId("pressable-flip-disabled").waitFor()
  })

  test("a control disabled while held never activates on release", async ({
    page,
  }) => {
    const probe = page.getByTestId("pressable-flip-disabled")
    await probe.scrollIntoViewIfNeeded()
    const box = await probe.boundingBox()
    if (!box) throw new Error("the probe has no box")
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    //premise: the press reached the engine and the probe pulled the rug
    await expect(page.locator("[data-lab-log]")).toContainText(
      "flip-disabled onPressDown",
    )
    await expect(probe).toHaveAttribute("data-disabled", "")
    await expect(probe).toHaveAttribute("aria-disabled", "true")
    //disabled mid-press is a hard cancel: the visual leaves at once
    await expect(probe).not.toHaveAttribute("data-pressed")
    await page.mouse.up()
    await page.waitForTimeout(300)
    await expect(page.locator("[data-lab-log]")).not.toContainText(
      "MUST NEVER APPEAR",
    )
    await expect(probe).not.toHaveAttribute("data-pressed")
  })

  test("a control unmounted while held throws nothing and activates nothing", async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    const probe = page.getByTestId("pressable-unmount")
    await probe.scrollIntoViewIfNeeded()
    const box = await probe.boundingBox()
    if (!box) throw new Error("the probe has no box")
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await expect(page.locator("[data-lab-log]")).toContainText(
      "unmount onPressDown",
    )
    await expect(probe).toHaveCount(0)
    await page.mouse.up()
    //the engine's timers were scheduled against the node; give them time to
    //have fired if the unmount had not torn them down
    await page.waitForTimeout(400)
    expect(errors).toEqual([])
    await expect(page.locator("[data-lab-log]")).not.toContainText(
      "MUST NEVER APPEAR",
    )
    //and the page is still alive: the reset remounts the probe and it presses
    await page.getByTestId("pressable-stress-reset").click()
    await expect(probe).toHaveCount(1)
  })
})

test.describe("Link under stress (both engines)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/link")
    await awaitClientHandover(page)
    await page.locator('a[data-adaptv="link"]').first().waitFor()
  })

  test("a tap on an in-app link pushes exactly one history entry, and a double-tap's second contact lands on the destination", async ({
    page,
  }) => {
    const link = page.getByRole("link", { name: "to the testing index" })
    await link.scrollIntoViewIfNeeded()
    const box = await link.boundingBox()
    if (!box) throw new Error("the link has no box")
    const depth = await page.evaluate(() => window.history.length)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    //premise: it navigated
    await page.waitForURL(/\/lab$/)
    await awaitClientHandover(page)
    expect(
      await page.evaluate(() => window.history.length),
      "the engine's onPress and the anchor's own click must not both navigate — back would then need two presses",
    ).toBe(depth + 1)
    //the second contact of a double-tap: the link is gone, so it reaches whatever
    //the destination put under the finger. That is the destination's own tap —
    //on the phone layout the lab index has a row there — and it may push at most
    //one more entry; what it may never do is re-run the first link
    await expect(link).toHaveCount(0)
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => window.history.length)
    expect(
      after,
      "a second contact is one tap, not a replay",
    ).toBeLessThanOrEqual(depth + 2)
  })

  test("a hold that spans a viewport swap still does not navigate; a tap after it does", async ({
    page,
  }) => {
    const link = page.getByRole("link", { name: "to the testing index" })
    await link.scrollIntoViewIfNeeded()
    const box = await link.boundingBox()
    if (!box) throw new Error("the link has no box")
    const size = page.viewportSize()
    if (!size) throw new Error("the project sets a viewport")
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(120)
    //rotate mid-hold: 390x844 ↔ 844x390 for the phone project, and the desktop
    //project swaps its own axes the same way
    await page.setViewportSize({ width: size.height, height: size.width })
    await page.waitForTimeout(400)
    await page.mouse.up()
    await page.waitForTimeout(300)
    expect(page.url(), "a hold is a hold, not a tap").toMatch(
      /\/lab\/link$/,
    )
    await page.setViewportSize(size)
    //premise for the negative above: the same link navigates on a clean tap
    await link.scrollIntoViewIfNeeded()
    await link.click()
    await page.waitForURL(/\/lab$/)
  })
})

test.describe("Fab under stress (both engines)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/fab")
    await awaitClientHandover(page)
    await page.getByTestId("fab").waitFor()
  })

  test("hidden toggled twenty times faster than its slide ends on the last parity", async ({
    page,
  }) => {
    const fab = page.getByTestId("fab")
    const toggle = page.getByTestId("fab-hidden-toggle")
    const size = page.viewportSize()
    if (!size) throw new Error("the project sets a viewport")
    const rest = await fab.boundingBox()
    if (!rest) throw new Error("the FAB has no box")

    for (let i = 0; i < 20; i += 1) await toggle.click()
    //even: shown, and back at rest, focusable, in the tree
    await expect(toggle).toHaveText("Hide")
    await expect(fab).not.toHaveAttribute("data-hidden")
    await expect(fab).not.toHaveAttribute("aria-hidden")
    await expect(fab).not.toHaveAttribute("tabindex")
    await expect
      .poll(async () => (await fab.boundingBox())?.y ?? Number.NaN, {
        timeout: 2000,
      })
      .toBeCloseTo(rest.y, 0)

    await toggle.click()
    //odd: hidden, inert, and fully below the bottom edge once the slide lands
    await expect(fab).toHaveAttribute("data-hidden", "")
    await expect(fab).toHaveAttribute("aria-hidden", "true")
    await expect(fab).toHaveAttribute("tabindex", "-1")
    await expect
      .poll(async () => (await fab.boundingBox())?.y ?? Number.NaN, {
        timeout: 2000,
      })
      .toBeGreaterThanOrEqual(size.height - 0.5)
  })
})
