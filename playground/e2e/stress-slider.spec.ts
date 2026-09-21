import type { CDPSession, Locator, Page } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import { expect, test } from "./support/reload-guard"
import {
  awaitStable,
  heapSample,
  installProbes,
  MB,
  rafOverQuiet,
  readProbe,
} from "./support/stress-probes"

/*
 * Slider under stress — the contracts `slider.spec.ts` pins one at a time, taken
 * in collision: a keyboard and a pointer on the same control at once, a drag that
 * runs far past both ends, the key grid at its edges, a disabled control hit
 * three ways, a finger on a slider inside a scroll box, and 300 press/release
 * cycles measured for listeners, heap and idle frames.
 *
 * Drivers: `page.mouse` for the drag cases (a mouse press is a drag from the
 * first pixel on both engines), `page.keyboard` for the grid, `touchscreen.tap`
 * for the tap, and CDP `Input.dispatchTouchEvent` for the scroll-box finger — the
 * one driver that is chromium-only, and the one whose PREMISE (a finger that
 * moves down from the slider scrolls the box) is asserted and skips the case
 * loudly when the harness cannot drive the browser's touch arbitration headless
 * (slider.spec.ts records that a synthetic TouchEvent never reaches it; CDP
 * touch is tried here because it does scroll a plain div). The heap and rAF
 * cases need CDP too. Everything else runs on both projects.
 *
 * Touch cases sit in a describe with `hasTouch` and a PORTRAIT viewport: a touch
 * context at the desktop project's 1280x720 makes the playground's rotate guard
 * cover the page (memory `touch-emulation-desktop-is-landscape`).
 *
 * Every value is read off the page's `[data-lab-readout=…]`, not the input.
 * Hydration gate first, no retries, no warm-ups, premise asserted per case.
 *
 * Not written, because the lab page has no knob for them: `disabled` flipped
 * mid-drag; a controlled↔uncontrolled switch mid-drag; a step that does not
 * divide the range (the "Min 5" slider's 15 range divides its step 3 exactly,
 * so End here lands on max itself — the off-grid End is covered by the unit
 * tests of `quantizeSliderValue`, not by this page).
 */

const ROOT = "[data-adaptv='slider']"
const THUMB = "[data-adaptv='slider-thumb']"

const input = (page: Page, name: string) =>
  page.getByRole("slider", { name, exact: true })

const root = (page: Page, name: string) =>
  page.locator(ROOT, { has: input(page, name) })

const readout = (page: Page, id: string) =>
  page.locator(`[data-lab-readout='${id}']`)

const readNumber = (page: Page, id: string) =>
  readout(page, id)
    .innerText()
    .then((t) => Number.parseFloat(t))

async function settledBox(target: Locator) {
  await target.scrollIntoViewIfNeeded()
  let previous = -1
  let box = await target.boundingBox()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (box && Math.round(box.y) === previous) break
    previous = box ? Math.round(box.y) : -1
    await target.page().waitForTimeout(50)
    box = await target.boundingBox()
  }
  if (!box) throw new Error("the slider root has no layout box")
  return box
}

/** The thumb-centre point for a value at `fraction` of the range (see slider.spec.ts). */
async function pointAt(target: Locator, fraction: number) {
  const box = await settledBox(target)
  const thumb = await target.locator(THUMB).boundingBox()
  const inset = (thumb?.width ?? 0) / 2
  return {
    x: box.x + inset + (box.width - 2 * inset) * fraction,
    y: box.y + box.height / 2,
  }
}

/** Confirm a point lands on the named root — CDP input has no actionability check. */
async function expectOnRoot(
  page: Page,
  target: Locator,
  point: { x: number; y: number },
) {
  const hit = await page.evaluate(
    ([x, y, selector]) => {
      const el = document.elementFromPoint(x as number, y as number)
      return {
        onRoot: !!el?.closest(selector as string),
        what: el
          ? `${el.tagName}.${String(el.className).slice(0, 60)}`
          : "nothing",
      }
    },
    [point.x, point.y, ROOT] as const,
  )
  const same = await target.evaluate(
    (el, [x, y]) =>
      document
        .elementFromPoint(x as number, y as number)
        ?.closest("[data-adaptv='slider']") === el,
    [point.x, point.y] as const,
  )
  if (!hit.onRoot || !same) {
    throw new Error(
      `point ${point.x.toFixed(0)},${point.y.toFixed(0)} misses the slider root — hit ${hit.what}. Stale measurement, not the component`,
    )
  }
}

/** Record whether `data-dragging` is EVER stamped on a root during a gesture. */
async function watchDragging(target: Locator) {
  await target.evaluate((el) => {
    const w = window as Window & { __draggingSeen?: boolean }
    w.__draggingSeen = el.hasAttribute("data-dragging")
    new MutationObserver(() => {
      if (el.hasAttribute("data-dragging")) w.__draggingSeen = true
    }).observe(el, {
      attributes: true,
      attributeFilter: ["data-dragging"],
    })
  })
}
const draggingSeen = (page: Page) =>
  page.evaluate(
    () => (window as Window & { __draggingSeen?: boolean }).__draggingSeen,
  )

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

test.describe("Slider under stress", () => {
  test.describe.configure({ timeout: 240_000 })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installProbes)
    await page.goto("/lab/slider")
    await awaitClientHandover(page)
    await input(page, "Volume").waitFor()
  })

  test("keyboard and pointer at once: the pointer owns the value while dragging, one commit on release", async ({
    page,
  }) => {
    const controlled = root(page, "Controlled")
    await expect(readout(page, "controlled-commits")).toHaveText("0")
    const start = await pointAt(controlled, 0.5)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await expect
      .poll(() => readNumber(page, "controlled"), {
        message: "the press at 50% must set ≈ 50",
      })
      .toBeGreaterThanOrEqual(48)
    const pressed = await readNumber(page, "controlled")
    expect(pressed).toBeLessThanOrEqual(52)
    await expect(controlled).toHaveAttribute("data-dragging", "")
    //PREMISE for the keys: the press focused the hidden input, so a key reaches it
    await expect(
      input(page, "Controlled"),
      "the press focuses the input",
    ).toBeFocused()

    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowRight")
    await expect
      .poll(() => readNumber(page, "controlled"), {
        message:
          "PREMISE: three ArrowRight presses during the hold must step the value by 3",
      })
      .toBe(pressed + 3)
    const commitsAfterKeys = await readNumber(page, "controlled-commits")

    //the pointer moves on: it owns the value, and the keys' contribution is gone
    const end = await pointAt(controlled, 0.25)
    for (let s = 1; s <= 3; s += 1) {
      await page.mouse.move(start.x + ((end.x - start.x) * s) / 3, start.y)
    }
    await expect
      .poll(() => readNumber(page, "controlled"), {
        message:
          "the pointer must own the value after the keys: ≈ 25 at a quarter",
      })
      .toBeLessThanOrEqual(27)
    const dragged = await readNumber(page, "controlled")
    expect(dragged).toBeGreaterThanOrEqual(23)
    await expect(controlled).toHaveAttribute("data-dragging", "")

    const commitsBeforeRelease = await readNumber(
      page,
      "controlled-commits",
    )
    await page.mouse.up()
    await expect(
      readout(page, "controlled-commits"),
      "the release is exactly one commit",
    ).toHaveText(String(commitsBeforeRelease + 1))
    await expect(controlled).not.toHaveAttribute("data-dragging")
    expect(
      await readNumber(page, "controlled-committed"),
      "the commit carries the pointer's value",
    ).toBe(dragged)
    await expect(input(page, "Controlled")).toHaveValue(String(dragged))
    test.info().annotations.push({
      type: "measured",
      description: `press ${pressed}, after keys ${pressed + 3}, after drag ${dragged}; commits from the three keys during the hold: ${commitsAfterKeys}`,
    })
  })

  test("dragging past both ends clamps and the thumb stays inside the root", async ({
    page,
  }) => {
    const volume = root(page, "Volume")
    const thumb = volume.locator(THUMB)
    const box = await settledBox(volume)
    const viewport = page.viewportSize()
    if (!viewport) throw new Error("no viewport")

    const start = await pointAt(volume, 0.5)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await expect
      .poll(() => readNumber(page, "volume"))
      .toBeGreaterThanOrEqual(48)

    const farLeft = Math.max(1, box.x - 100)
    expect(
      farLeft,
      "PREMISE: the target is outside the root",
    ).toBeLessThan(box.x)
    for (let s = 1; s <= 4; s += 1) {
      await page.mouse.move(
        start.x + ((farLeft - start.x) * s) / 4,
        start.y,
      )
    }
    await expect(readout(page, "volume"), "clamps at min").toHaveText("0")
    let thumbBox = await thumb.boundingBox()
    if (!thumbBox) throw new Error("the thumb has no layout box")
    expect(
      thumbBox.x,
      "at min the thumb's left edge stays inside the root",
    ).toBeGreaterThanOrEqual(box.x - 0.5)

    const farRight = Math.min(viewport.width - 1, box.x + box.width + 100)
    expect(
      farRight,
      "PREMISE: the target is outside the root",
    ).toBeGreaterThan(box.x + box.width)
    for (let s = 1; s <= 4; s += 1) {
      await page.mouse.move(
        farLeft + ((farRight - farLeft) * s) / 4,
        start.y,
      )
    }
    await expect(readout(page, "volume"), "clamps at max").toHaveText(
      "100",
    )
    thumbBox = await thumb.boundingBox()
    if (!thumbBox) throw new Error("the thumb has no layout box")
    expect(
      thumbBox.x + thumbBox.width,
      "at max the thumb's right edge stays inside the root",
    ).toBeLessThanOrEqual(box.x + box.width + 0.5)

    //and back inside: the value follows again, no stuck clamp
    const mid = await pointAt(volume, 0.5)
    await page.mouse.move(mid.x, mid.y)
    await expect
      .poll(() => readNumber(page, "volume"))
      .toBeLessThanOrEqual(52)
    expect(await readNumber(page, "volume")).toBeGreaterThanOrEqual(48)
    await page.mouse.up()
    await expect(volume).not.toHaveAttribute("data-dragging")
    await expect(input(page, "Volume")).toHaveValue(
      String(await readNumber(page, "volume")),
    )
  })

  test("the key grid at its ends: End lands on the last grid point at or below max, Home on min, PageUp clamps", async ({
    page,
  }) => {
    const grid = input(page, "Grid")
    const [min, max, step] = await Promise.all(
      ["min", "max", "step"].map((name) =>
        grid.getAttribute(name).then((v) => Number(v)),
      ),
    )
    expect(Number.isFinite(min) && Number.isFinite(max) && step > 0).toBe(
      true,
    )
    const lastGridPoint = min + Math.floor((max - min) / step) * step
    await grid.focus()
    await expect(grid).toBeFocused()

    await page.keyboard.press("End")
    await expect
      .poll(() => readNumber(page, "grid"), { message: "End must move" })
      .not.toBe(min)
    const atEnd = await readNumber(page, "grid")
    expect(atEnd, "End never lands above max").toBeLessThanOrEqual(max)
    expect(
      Number.isInteger(Math.round(((atEnd - min) / step) * 1e6) / 1e6),
      `End must land on the grid: (${atEnd} − ${min}) / ${step}`,
    ).toBe(true)
    expect(atEnd, "End is the last grid point at or below max").toBe(
      lastGridPoint,
    )

    await page.keyboard.press("Home")
    await expect(readout(page, "grid")).toHaveText(String(min))

    await page.keyboard.press("PageUp")
    await expect(readout(page, "grid")).toHaveText(
      String(Math.min(lastGridPoint, min + 10 * step)),
    )
    await page.keyboard.press("PageDown")
    await expect(
      readout(page, "grid"),
      "PageDown from the top clamps at min",
    ).toHaveText(String(min))
    test.info().annotations.push({
      type: "measured",
      description: `min ${min} max ${max} step ${step}: End ${atEnd}, last grid point ${lastGridPoint} (the range divides the step, so the off-grid End needs a lab knob)`,
    })
  })

  test.describe("touch", () => {
    //portrait on purpose: a touch device at the desktop project's 1280x720 is a
    //phone held sideways, and the playground's rotate guard covers the page
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

    test("disabled slider ignores mouse, keyboard and tap", async ({
      page,
    }) => {
      const disabled = input(page, "Disabled slider")
      const disabledRoot = root(page, "Disabled slider")
      await expect(disabled).toBeDisabled()
      await expect(disabled).toHaveValue("60")
      await watchDragging(disabledRoot)

      const point = await pointAt(disabledRoot, 0.9)
      await expectOnRoot(page, disabledRoot, point)
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      await page.mouse.move(point.x - 30, point.y)
      await page.mouse.up()
      await expect(disabled, "a mouse press must not move it").toHaveValue(
        "60",
      )

      await disabled.focus()
      await expect(
        disabled,
        "a disabled input cannot take focus",
      ).not.toBeFocused()
      await page.keyboard.press("ArrowRight")
      await page.keyboard.press("End")
      await expect(disabled, "keys must not move it").toHaveValue("60")

      await page.touchscreen.tap(point.x, point.y)
      await page.waitForTimeout(150)
      await expect(disabled, "a tap must not move it").toHaveValue("60")
      await expect(readout(page, "disabled-changes")).toHaveText("0")
      expect(
        await draggingSeen(page),
        "data-dragging was never stamped",
      ).toBe(false)
      await expect(disabledRoot).toHaveAttribute("data-disabled", "")
    })

    test("vertical touch on the slider in the scroll box scrolls the box and leaves the value; horizontal moves the value and not the box", async ({
      page,
      browserName,
    }) => {
      test.skip(
        browserName !== "chromium",
        "CDP touch injection is chromium-only",
      )
      const cdp = await page.context().newCDPSession(page)
      const scrollBox = page.locator("[data-lab-scroll-box]")

      /** Centre the boxed slider in its box and the box on screen, then aim. */
      const aimBoxed = async () => {
        const boxed = root(page, "Boxed")
        await boxed.evaluate((el) =>
          el.scrollIntoView({ block: "center", inline: "nearest" }),
        )
        const box = await settledBox(boxed)
        const centre = {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        }
        await expectOnRoot(page, boxed, centre)
        await watchDragging(boxed)
        return { boxed, centre }
      }

      const { boxed, centre } = await aimBoxed()
      await expect(readout(page, "boxed")).toHaveText("20")
      const before = await scrollBox.evaluate((el) => el.scrollTop)
      const max = await scrollBox.evaluate(
        (el) => el.scrollHeight - el.clientHeight,
      )
      expect(
        max - before,
        "PREMISE: the box has room to scroll further down",
      ).toBeGreaterThan(40)

      //a finger that lands on the slider and moves straight UP the screen
      await touch(cdp, "touchStart", centre)
      for (let s = 1; s <= 12; s += 1) {
        await touch(cdp, "touchMove", {
          x: centre.x,
          y: centre.y - 10 * s,
        })
      }
      await touch(cdp, "touchEnd")
      const after = await awaitStable(
        () => scrollBox.evaluate((el) => el.scrollTop),
        { message: "the box never settled" },
      )
      const seen = await draggingSeen(page)
      const value = await readNumber(page, "boxed")
      test.info().annotations.push({
        type: "measured",
        description: `vertical: box scrollTop ${before} → ${after} (max ${max}); value ${value}; data-dragging seen: ${seen}`,
      })
      //PREMISE: the browser took the vertical gesture as a scroll. A premise
      //that does not hold is a failure that names itself, not a skip: a
      //skipped case reads green and this one would be measuring nothing
      expect(
        after,
        `PREMISE: CDP touch must scroll the box from a slider start (scrollTop ${before} → ${after})`,
      ).toBeGreaterThan(before)
      expect(value, "a vertical finger leaves the value alone").toBe(20)
      expect(
        seen,
        "data-dragging is never stamped by a vertical finger",
      ).toBe(false)
      await expect(boxed).not.toHaveAttribute("data-dragging")

      //a fresh page, and a finger that moves sideways
      await page.goto("/lab/slider")
      await awaitClientHandover(page)
      await input(page, "Boxed").waitFor()
      const fresh = await aimBoxed()
      const boxBefore = await scrollBox.evaluate((el) => el.scrollTop)
      await touch(cdp, "touchStart", fresh.centre)
      for (let s = 1; s <= 12; s += 1) {
        await touch(cdp, "touchMove", {
          x: fresh.centre.x + (100 * s) / 12,
          y: fresh.centre.y,
        })
      }
      await expect
        .poll(() => readNumber(page, "boxed"), {
          message:
            "PREMISE: a horizontal finger past the 6px slop locks and drags",
        })
        .not.toBe(20)
      expect(
        await draggingSeen(page),
        "the lock stamps data-dragging",
      ).toBe(true)
      await touch(cdp, "touchEnd")
      await expect(fresh.boxed).not.toHaveAttribute("data-dragging")
      const boxAfter = await awaitStable(
        () => scrollBox.evaluate((el) => el.scrollTop),
        { message: "the box never settled" },
      )
      expect(boxAfter, "a horizontal drag must not scroll the box").toBe(
        boxBefore,
      )
      test.info().annotations.push({
        type: "measured",
        description: `horizontal: value 20 → ${await readNumber(page, "boxed")}; box scrollTop ${boxBefore} → ${boxAfter}`,
      })
    })
  })

  test("300 tap cycles: no listener growth, heap plateau, rAF idle after", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "heap sampling needs CDP")
    const cdp = await page.context().newCDPSession(page)
    const volume = root(page, "Volume")
    const low = await pointAt(volume, 0.2)
    const high = await pointAt(volume, 0.8)
    const before = await readProbe(page)
    expect(
      before.listeners.window + before.listeners.document,
      "PREMISE: the probe sees the app's own listeners",
    ).toBeGreaterThan(0)

    const cycles = 300
    const samples: number[] = []
    for (let i = 0; i < cycles; i += 1) {
      const target = i % 2 === 0 ? low : high
      await page.mouse.click(target.x, target.y)
      if ((i + 1) % (cycles / 3) === 0) {
        //PREMISE at every checkpoint: the clicks are landing
        const expected = i % 2 === 0 ? 20 : 80
        await expect
          .poll(() => readNumber(page, "volume"), {
            message: `cycle ${i + 1}: the click must have set ≈ ${expected}`,
          })
          .toBeGreaterThanOrEqual(expected - 2)
        expect(await readNumber(page, "volume")).toBeLessThanOrEqual(
          expected + 2,
        )
        samples.push(await heapSample(cdp, page))
      }
    }
    await expect(volume).not.toHaveAttribute("data-dragging")
    const after = await readProbe(page)
    const [h1, h2, h3] = samples
    const delta12 = h2 - h1
    const delta23 = h3 - h2
    test.info().annotations.push({
      type: "measured",
      description: `heap after GC: ${(h1 / MB).toFixed(2)} / ${(h2 / MB).toFixed(2)} / ${(h3 / MB).toFixed(2)} MB (Δ ${(delta12 / MB).toFixed(2)}, ${(delta23 / MB).toFixed(2)}); listeners window ${before.listeners.window}→${after.listeners.window}, document ${before.listeners.document}→${after.listeners.document}`,
    })
    expect(
      after.listeners,
      "listener counts must return to baseline",
    ).toEqual(before.listeners)
    expect(
      delta23,
      `heap growth must plateau: Δ(2→3) ${(delta23 / MB).toFixed(2)} MB vs Δ(1→2) ${(delta12 / MB).toFixed(2)} MB`,
    ).toBeLessThanOrEqual(delta12 + 1 * MB)
    const quiet = await rafOverQuiet(page, 1000)
    expect(
      quiet.ran + quiet.requested,
      `rAF over 1s at rest must be 0 — callers: ${JSON.stringify(quiet.callers)}`,
    ).toBe(0)
  })
})
