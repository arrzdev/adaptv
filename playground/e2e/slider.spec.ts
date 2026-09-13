import type { Locator, Page } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import { expect, test } from "./support/reload-guard"

/*
 * Slider — a painted track over a hidden native range input, driven by a
 * pointer engine with one rule a native range cannot keep: a press anywhere on
 * the 44px root sets the value, and a TOUCH that moves vertically first yields
 * to the page scroll.
 *
 * This file pins the parts that are deterministic headless on both engines:
 * the hidden input's semantics, the MOUSE press-and-drag (a mouse has no scroll
 * to protect, so a press is always a drag and the value must follow the pointer
 * from the first pixel), the keyboard grid, the thumb's geometry at both ends,
 * disabled inertness, and the commit-once contract. Every value is read back off
 * the page's own readouts — `[data-lab-readout=…]` — the way the toggles suite
 * reads the log, because the readout IS how the page reports what a gesture did.
 *
 * The TOUCH half — a vertical finger scrolls and leaves the value alone, a
 * horizontal one past 6px locks and drags — is NOT here. Synthetic touch does not
 * drive the engine's native scroll arbitration headless (see swipeable.spec.ts),
 * so the scroll-box card is walked with a real finger: `adb shell input swipe` on
 * the Android emulator and idb on the iOS simulator. The one touch gesture that
 * IS here is the tap: a finger that lifts where it landed asks nothing of the
 * scroll arbitration, so `touchscreen.tap` proves it on both engines, and it is
 * the gesture both simulators showed doing nothing before the lift became the
 * set. Both projects run here because a mouse pointer reaches React identically
 * on either engine.
 *
 * No retries, no warm-ups: a flake in this file is logic.
 */

const ROOT = "[data-adaptv='slider']"
const THUMB = "[data-adaptv='slider-thumb']"

/** The hidden `<input type=range>` is the accessible slider. */
const input = (page: Page, name: string) =>
  page.getByRole("slider", { name, exact: true })

/** The root that owns a named input — the 44px hit area the mouse aims at. */
const root = (page: Page, name: string) =>
  page.locator(ROOT, { has: input(page, name) })

const readout = (page: Page, id: string) =>
  page.locator(`[data-lab-readout='${id}']`)

const readNumber = (page: Page, id: string) =>
  readout(page, id)
    .innerText()
    .then((t) => Number.parseFloat(t))

/**
 * A settled, on-screen box for a root. `boundingBox()` is viewport-relative and
 * the page scrolls inside a ScrollView, so the root is brought into view first
 * and the box re-read until it stops moving.
 */
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

/**
 * The point a value at `fraction` of the range puts the THUMB'S CENTRE, on the
 * root's vertical centre. The thumb travels `fraction × (root − thumb)` from a
 * half-thumb inset so it never overhangs, and the pointer mapping is defined by
 * the same inset: a press on the thumb's centre reads back the value that put
 * it there. Aiming at the raw `fraction × root width` instead would read 77 for
 * 75 at phone widths — not a bug, just the wrong question.
 */
async function pointAt(target: Locator, fraction: number) {
  const box = await settledBox(target)
  const thumb = await target.locator(THUMB).boundingBox()
  const inset = (thumb?.width ?? 0) / 2
  return {
    x: box.x + inset + (box.width - 2 * inset) * fraction,
    y: box.y + box.height / 2,
  }
}

test.describe("Slider", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/slider")
    await awaitClientHandover(page)
    await input(page, "Volume").waitFor()
  })

  test("the hidden input carries the semantics", async ({ page }) => {
    const volume = input(page, "Volume")
    await expect(volume).toHaveAttribute("type", "range")
    await expect(volume).toHaveAttribute("aria-label", "Volume")
    await expect(volume).toHaveAttribute("min", "0")
    await expect(volume).toHaveAttribute("max", "100")
    await expect(volume).toHaveAttribute("step", "1")
    await expect(volume).toHaveValue("40")

    const volumeRoot = root(page, "Volume")
    await expect(volumeRoot).toHaveAttribute(
      "data-orientation",
      "horizontal",
    )
    await expect(volumeRoot).not.toHaveAttribute("data-dragging")
    // the inline var the paint is derived from — 40 of 100 is 0.4
    const fill = await volumeRoot.evaluate((el) =>
      Number.parseFloat(
        (el as HTMLElement).style.getPropertyValue("--slider-fill"),
      ),
    )
    expect(fill, "--slider-fill must be value ÷ range").toBeCloseTo(0.4, 5)
    // and the page's own probe reads the same number back
    await expect(readout(page, "volume-fill")).toHaveText("0.4")
  })

  test("a mouse press on the track sets the value and a drag follows the pointer", async ({
    page,
  }) => {
    const volumeRoot = root(page, "Volume")
    const start = await pointAt(volumeRoot, 0.75)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()

    // the press itself sets the value — no drag needed, unlike a native range
    await expect
      .poll(() => readNumber(page, "volume"), {
        message:
          "a press at 75% must set the value to ≈ 75 on pointerdown",
      })
      .toBeGreaterThanOrEqual(73)
    expect(await readNumber(page, "volume")).toBeLessThanOrEqual(77)
    await expect(volumeRoot, "a live drag is stamped").toHaveAttribute(
      "data-dragging",
      "",
    )

    // drag left to 25% in five steps; the value must fall with every step
    const steps = 5
    let previous = await readNumber(page, "volume")
    for (let s = 1; s <= steps; s += 1) {
      const fraction = 0.75 - (0.5 * s) / steps
      const expected = fraction * 100
      const point = await pointAt(volumeRoot, fraction)
      await page.mouse.move(point.x, point.y)
      await expect
        .poll(() => readNumber(page, "volume"), {
          message: `step ${s}: the value must reach ≈ ${expected}`,
        })
        .toBeLessThanOrEqual(expected + 2)
      const now = await readNumber(page, "volume")
      expect(now, `step ${s}: must not go back up`).toBeLessThanOrEqual(
        previous,
      )
      previous = now
    }
    expect(previous).toBeGreaterThanOrEqual(23)
    expect(previous).toBeLessThanOrEqual(27)

    await page.mouse.up()
    await expect(
      volumeRoot,
      "release clears the stamp",
    ).not.toHaveAttribute("data-dragging")
    // the drag's value is what stays, and the hidden input agrees
    await expect(input(page, "Volume")).toHaveValue(String(previous))
  })

  test("one drag commits exactly once while it reports every change", async ({
    page,
  }) => {
    const controlled = root(page, "Controlled")
    await expect(readout(page, "controlled-changes")).toHaveText("0")
    await expect(readout(page, "controlled-commits")).toHaveText("0")

    const start = await pointAt(controlled, 0.75)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await expect
      .poll(() => readNumber(page, "controlled"))
      .toBeGreaterThanOrEqual(73)
    for (let s = 1; s <= 5; s += 1) {
      const point = await pointAt(controlled, 0.75 - 0.1 * s)
      await page.mouse.move(point.x, point.y)
    }
    await expect
      .poll(() => readNumber(page, "controlled"))
      .toBeLessThanOrEqual(27)
    // nothing has been released yet — no commit may have fired
    await expect(readout(page, "controlled-commits")).toHaveText("0")
    await page.mouse.up()

    await expect(
      readout(page, "controlled-commits"),
      "one press-and-release is one commit",
    ).toHaveText("1")
    expect(
      await readNumber(page, "controlled-changes"),
      "the press and the moves each reported",
    ).toBeGreaterThanOrEqual(2)
    const committed = await readNumber(page, "controlled-committed")
    expect(committed, "the commit carries the released value").toBe(
      await readNumber(page, "controlled"),
    )
  })

  test("keyboard steps the hidden input and commits per key", async ({
    page,
  }) => {
    const opacity = input(page, "Opacity")
    await expect(readout(page, "opacity")).toHaveText("0")
    await opacity.focus()

    await page.keyboard.press("ArrowRight")
    await expect(readout(page, "opacity")).toHaveText("0.1")
    await page.keyboard.press("ArrowRight")
    await expect(readout(page, "opacity")).toHaveText("0.2")
    await page.keyboard.press("ArrowRight")
    // the whole point of the row: 0.1 + 0.1 + 0.1 must not print as 0.30000000000000004
    await expect(readout(page, "opacity")).toHaveText("0.3")
    await expect(opacity).toHaveValue("0.3")
    await expect(readout(page, "opacity-commits")).toHaveText("3")

    await page.keyboard.press("End")
    await expect(readout(page, "opacity")).toHaveText("1")
    await expect(readout(page, "opacity-commits")).toHaveText("4")

    await page.keyboard.press("Home")
    await expect(readout(page, "opacity")).toHaveText("0")
    await expect(readout(page, "opacity-commits")).toHaveText("5")
  })

  test("the grid starts at min", async ({ page }) => {
    const grid = input(page, "Grid")
    await expect(grid).toHaveAttribute("min", "5")
    await expect(grid).toHaveAttribute("step", "3")
    await expect(readout(page, "grid")).toHaveText("5")
    await grid.focus()

    await page.keyboard.press("ArrowLeft")
    // at min already: nothing below 5, and 5 itself is not a multiple of 3
    await expect(readout(page, "grid")).toHaveText("5")
    await expect(grid).toHaveValue("5")

    await page.keyboard.press("ArrowRight")
    await expect(readout(page, "grid")).toHaveText("8")
    await page.keyboard.press("ArrowRight")
    await expect(readout(page, "grid")).toHaveText("11")
    await expect(grid).toHaveValue("11")
  })

  test("the thumb never overhangs", async ({ page }) => {
    const controlled = root(page, "Controlled")
    const thumb = controlled.locator(THUMB)

    for (const [label, value] of [
      ["set 0", "0"],
      ["set 100", "100"],
    ] as const) {
      await page.getByRole("button", { name: label, exact: true }).click()
      await expect(readout(page, "controlled")).toHaveText(value)
      await expect(input(page, "Controlled")).toHaveValue(value)

      const rootBox = await settledBox(controlled)
      const thumbBox = await thumb.boundingBox()
      if (!thumbBox) throw new Error("the thumb has no layout box")
      // half a pixel of tolerance for sub-pixel layout; a real overhang is the
      // thumb's full radius
      expect(
        thumbBox.x,
        `${label}: the thumb's left edge must stay inside the root`,
      ).toBeGreaterThanOrEqual(rootBox.x - 0.5)
      expect(
        thumbBox.x + thumbBox.width,
        `${label}: the thumb's right edge must stay inside the root`,
      ).toBeLessThanOrEqual(rootBox.x + rootBox.width + 0.5)
    }
  })

  test("disabled is inert", async ({ page }) => {
    const disabled = input(page, "Disabled slider")
    const disabledRoot = root(page, "Disabled slider")
    await expect(disabled).toBeDisabled()
    await expect(disabled).toHaveValue("60")
    await expect(disabledRoot).toHaveAttribute("data-disabled", "")

    const point = await pointAt(disabledRoot, 0.1)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x + 40, point.y)
    await page.mouse.up()
    await page.waitForTimeout(150)

    await expect(disabled, "a press must not move it").toHaveValue("60")
    await expect(disabledRoot).not.toHaveAttribute("data-dragging")
    await expect(
      readout(page, "disabled-changes"),
      "a disabled control must never report",
    ).toHaveText("0")
  })

  /*
   * The mouse half of the scroll-box contract only. A finger that lands on the
   * slider and moves straight down must scroll the box and leave the value alone
   * — but synthetic touch cannot prove it headless, because the browser's own
   * touch-slop arbitration is the thing under test and dispatched TouchEvents
   * never reach it (see swipeable.spec.ts). That side is walked on the Android
   * emulator with `adb shell input swipe` and on the iOS simulator with idb.
   *
   * A mouse has no scroll gesture to protect, so for a mouse the same motion is
   * a plain drag: the box must not scroll, and the value must keep following the
   * pointer's x even as it moves off the track vertically.
   */
  test("a vertical mouse drag inside the scroll box is a slider drag, a touch is not", async ({
    page,
  }) => {
    const boxed = root(page, "Boxed")
    const scrollBox = page.locator("[data-lab-scroll-box]")
    await expect(readout(page, "boxed")).toHaveText("20")

    // press at 30%, then drag DOWN 120px while drifting right to 80%. The box's
    // scrollTop is read AFTER the root is brought on screen — that scroll is the
    // harness's, not the drag's — and the readout is made to agree with it first
    const start = await pointAt(boxed, 0.3)
    const before = await scrollBox.evaluate((el) => el.scrollTop)
    await expect(readout(page, "box-scroll-top")).toHaveText(`${before}px`)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await expect(boxed).toHaveAttribute("data-dragging", "")
    const end = await pointAt(boxed, 0.8)
    for (let s = 1; s <= 6; s += 1) {
      await page.mouse.move(
        start.x + ((end.x - start.x) * s) / 6,
        start.y + 20 * s,
      )
    }
    await expect
      .poll(() => readNumber(page, "boxed"), {
        message:
          "a mouse drag keeps following x after it leaves the track vertically",
      })
      .toBeGreaterThanOrEqual(78)
    await page.mouse.up()
    await expect(boxed).not.toHaveAttribute("data-dragging")

    expect(
      await scrollBox.evaluate((el) => el.scrollTop),
      "a mouse drag must not scroll the box",
    ).toBe(before)
    await expect(readout(page, "box-scroll-top")).toHaveText(`${before}px`)
  })

  test.describe("touch", () => {
    // portrait on purpose: a touch device at the desktop project's 1280x720 is a
    // phone held sideways, and the playground's rotate guard covers the page
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

    test("a finger that lifts where it landed sets the value on the lift and commits once", async ({
      page,
    }) => {
      const controlled = root(page, "Controlled")
      await expect(readout(page, "controlled")).toHaveText("25")
      await expect(readout(page, "controlled-changes")).toHaveText("0")

      const point = await pointAt(controlled, 0.75)
      await page.touchscreen.tap(point.x, point.y)

      await expect
        .poll(() => readNumber(page, "controlled"), {
          message: "the tap itself sets the value, no drag needed",
        })
        .toBeGreaterThanOrEqual(73)
      await expect(
        readout(page, "controlled-changes"),
        "one tap is one change",
      ).toHaveText("1")
      await expect(
        readout(page, "controlled-commits"),
        "and one commit",
      ).toHaveText("1")
      expect(await readNumber(page, "controlled-committed")).toBe(
        await readNumber(page, "controlled"),
      )
      await expect(controlled).not.toHaveAttribute("data-dragging")
    })
  })
})
