import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Fab — a Button pinned to the safe corner, whose whole contract is geometry:
 * a fixed gap off the SAFE edges, a rise of exactly the keyboard height, a slide
 * below the screen when hidden, and a mirror under RTL. Every one of those is
 * an inline style the browser resolves, so every one is assertable off the
 * bounding box against the viewport.
 *
 * A browser tab has no safe-area insets and no on-screen keyboard, which is
 * what makes the numbers exact here: the insets are 0, so the resting gap IS
 * `gap × --spacing`, and the keyboard is adaptv's test seam
 * (window.__adaptvKeyboardMock, installed pre-mount, then adaptv:keyboard-mock
 * events — the same seam the Keyboard and AvoidKeyboard specs drive), so the
 * rise is exactly the height the mock reports. The real inset and the real
 * keyboard are the simulator's job; this spec pins the arithmetic.
 *
 * The press test drives the FAB with a plain `locator.click()`: the press
 * engine commits a clean down/up pair on both engines (the Link spec proved the
 * same thing) and only swallows a moved, held or cancelled press. The moved
 * and held cases stay on the sim.
 */

const KEYBOARD_EVENT = "adaptv:keyboard-mock"

async function setKeyboard(page: Page, isOpen: boolean, height: number) {
  await page.evaluate(
    ({ o, h, evt }) => {
      ;(
        window as unknown as { __adaptvKeyboardMock?: unknown }
      ).__adaptvKeyboardMock = { isOpen: o, height: h }
      window.dispatchEvent(new Event(evt))
    },
    { o: isOpen, h: height, evt: KEYBOARD_EVENT },
  )
}

/**
 * Wait for the client to take over before touching the page.
 *
 * Every lab page is server-rendered, so a `waitFor()` on the FAB is satisfied
 * by inert HTML, and a toggle clicked before its handler is attached is
 * dropped — the placement never changes and the box is measured where it
 * already was, which reads as the component ignoring its prop. It is not
 * load flake: Playwright boots its own dev server per run, so the FIRST test
 * to reach this route pays the cold transform cost and loses the race while
 * every test after it wins. A dev session left running hides it entirely,
 * because `reuseExistingServer` then hands the suite a warm server.
 *
 * The splash is server-rendered too and self-unmounts only once the client
 * has hydrated and the local store has seeded, so its disappearance is the
 * one honest "React is driving now" signal on the page. Given a generous
 * timeout on purpose — a cold route's first transform can outrun the 5s
 * default.
 */
async function awaitClientHandover(page: Page) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
}

/** The default gap, 4 spacing units, resolved to px off `--spacing` on <html>. */
async function restingGapPx(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement
    const raw = getComputedStyle(root).getPropertyValue("--spacing").trim()
    const value = Number.parseFloat(raw)
    const unit = raw.replace(/[\d.-]/g, "")
    const px =
      unit === "rem"
        ? value * Number.parseFloat(getComputedStyle(root).fontSize)
        : value
    return px * 4
  })
}

function viewport(page: Page) {
  const size = page.viewportSize()
  if (!size) throw new Error("the project sets a viewport; none found")
  return size
}

/** The FAB's box against the viewport: the gaps a finger actually finds. */
async function readBox(page: Page) {
  const box = await page.getByTestId("fab").boundingBox()
  if (!box) throw new Error("the FAB has no box — is it in the DOM?")
  const { width, height } = viewport(page)
  return {
    top: box.y,
    gapBottom: height - (box.y + box.height),
    gapRight: width - (box.x + box.width),
    gapLeft: box.x,
    centerX: box.x + box.width / 2,
  }
}

test.describe("Fab", () => {
  test.beforeEach(async ({ page }) => {
    // install the mock BEFORE the hook's effect runs, or it never enters mock mode
    await page.addInitScript(() => {
      ;(
        window as unknown as { __adaptvKeyboardMock?: unknown }
      ).__adaptvKeyboardMock = { isOpen: false, height: 0 }
    })
    await page.goto("/lab/fab")
    await awaitClientHandover(page)
    await page.getByTestId("fab").waitFor()
  })

  test("is a fixed button in the bottom-end corner, one gap off both edges", async ({
    page,
  }) => {
    const fab = page.getByTestId("fab")
    expect(await fab.evaluate((el) => el.tagName)).toBe("BUTTON")
    await expect(fab).toHaveAttribute("data-adaptv", "fab")
    await expect(fab).toHaveAttribute("data-placement", "end")
    await expect(fab).toHaveAttribute("aria-label", "New task")
    expect(await fab.evaluate((el) => getComputedStyle(el).position)).toBe(
      "fixed",
    )

    // the insets are 0 in a browser tab, so the gap is exactly gap × spacing
    const gap = await restingGapPx(page)
    expect(gap).toBeGreaterThan(0)
    const box = await readBox(page)
    expect(Math.abs(box.gapBottom - gap)).toBeLessThanOrEqual(1)
    expect(Math.abs(box.gapRight - gap)).toBeLessThanOrEqual(1)
    // and the readout agrees with the box, not just with itself
    await expect(page.getByTestId("fab-readout")).toContainText(
      `${Math.round(gap)}px`,
    )
  })

  test("rises by exactly the keyboard height and stamps data-keyboard-open", async ({
    page,
  }) => {
    const fab = page.getByTestId("fab")
    const rest = await readBox(page)

    await setKeyboard(page, true, 300)
    await expect(fab).toHaveAttribute("data-keyboard-open", "")
    await expect
      .poll(async () => (await readBox(page)).gapBottom)
      .toBeCloseTo(rest.gapBottom + 300, 0)
    // the inline axis is untouched by the keyboard
    expect((await readBox(page)).gapRight).toBeCloseTo(rest.gapRight, 0)

    await setKeyboard(page, false, 0)
    await expect(fab).not.toHaveAttribute("data-keyboard-open")
    await expect
      .poll(async () => (await readBox(page)).gapBottom)
      .toBeCloseTo(rest.gapBottom, 0)
  })

  test("lifts only by the overlap when the layout viewport shrinks for the keyboard", async ({
    page,
  }) => {
    // the Android WebView resizes by the keyboard's height, so `bottom: 0` is
    // already the keyboard's top edge — the lift must be what the viewport did
    // NOT absorb, or the button ends a keyboard's height above the keyboard.
    // A viewport resize here IS that shrink.
    const rest = await readBox(page)
    const { width, height } = viewport(page)

    await setKeyboard(page, true, 300)
    await expect
      .poll(async () => (await readBox(page)).gapBottom)
      .toBeCloseTo(rest.gapBottom + 300, 0)

    await page.setViewportSize({ width, height: height - 300 })
    await expect
      .poll(async () => (await readBox(page)).gapBottom)
      .toBeCloseTo(rest.gapBottom, 0)

    // the viewport grows back with the keyboard still up: the lift returns
    await page.setViewportSize({ width, height })
    await expect
      .poll(async () => (await readBox(page)).gapBottom)
      .toBeCloseTo(rest.gapBottom + 300, 0)

    await setKeyboard(page, false, 0)
    await expect
      .poll(async () => (await readBox(page)).gapBottom)
      .toBeCloseTo(rest.gapBottom, 0)
  })

  test("with the keyboard lift off it stays put under the keyboard", async ({
    page,
  }) => {
    const rest = await readBox(page)
    await page.getByTestId("fab-avoid-toggle").click()
    await expect(page.getByTestId("fab-avoid-toggle")).toHaveText(
      "Keyboard lift off",
    )

    await setKeyboard(page, true, 300)
    // the contract on <html> is live — the FAB just chose not to consume it
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--adaptv-keyboard-height")
            .trim(),
        ),
      )
      .toBe("300px")
    expect((await readBox(page)).gapBottom).toBeCloseTo(rest.gapBottom, 0)

    // and turning the lift back on while the keyboard is up lifts it now
    await page.getByTestId("fab-avoid-toggle").click()
    await expect
      .poll(async () => (await readBox(page)).gapBottom)
      .toBeCloseTo(rest.gapBottom + 300, 0)

    await setKeyboard(page, false, 0)
  })

  test("hidden slides it below the viewport and out of the tab order; show brings it back", async ({
    page,
  }) => {
    const fab = page.getByTestId("fab")
    const toggle = page.getByTestId("fab-hidden-toggle")
    const rest = await readBox(page)
    const { height } = viewport(page)

    await toggle.click()
    await expect(fab).toHaveAttribute("data-hidden", "")
    await expect(fab).toHaveAttribute("aria-hidden", "true")
    await expect(fab).toHaveAttribute("tabindex", "-1")
    // after the slide, the whole box is at or below the bottom edge
    await expect
      .poll(async () => (await readBox(page)).top)
      .toBeGreaterThanOrEqual(height - 0.5)

    await toggle.click()
    await expect(fab).not.toHaveAttribute("data-hidden")
    await expect(fab).not.toHaveAttribute("aria-hidden")
    await expect(fab).not.toHaveAttribute("tabindex")
    await expect
      .poll(async () => (await readBox(page)).gapBottom)
      .toBeCloseTo(rest.gapBottom, 0)
  })

  test("center is dead-centre and start is the mirror of end", async ({
    page,
  }) => {
    const fab = page.getByTestId("fab")
    const gap = await restingGapPx(page)
    const { width } = viewport(page)

    await page.getByTestId("fab-placement-center").click()
    await expect(fab).toHaveAttribute("data-placement", "center")
    await expect
      .poll(async () =>
        Math.abs((await readBox(page)).centerX - width / 2),
      )
      .toBeLessThanOrEqual(1)

    await page.getByTestId("fab-placement-start").click()
    await expect(fab).toHaveAttribute("data-placement", "start")
    await expect
      .poll(async () => Math.abs((await readBox(page)).gapLeft - gap))
      .toBeLessThanOrEqual(1)

    await page.getByTestId("fab-placement-end").click()
    await expect(fab).toHaveAttribute("data-placement", "end")
    await expect
      .poll(async () => Math.abs((await readBox(page)).gapRight - gap))
      .toBeLessThanOrEqual(1)
  })

  test("end mirrors to the left corner under RTL — the offset is inset-inline", async ({
    page,
  }) => {
    const gap = await restingGapPx(page)
    await page.getByTestId("fab-rtl-toggle").click()
    await expect
      .poll(async () => Math.abs((await readBox(page)).gapLeft - gap))
      .toBeLessThanOrEqual(1)
    // and back
    await page.getByTestId("fab-rtl-toggle").click()
    await expect
      .poll(async () => Math.abs((await readBox(page)).gapRight - gap))
      .toBeLessThanOrEqual(1)
  })

  test("a press increments the counter exactly once", async ({ page }) => {
    const presses = page.getByTestId("fab-presses")
    await expect(presses).toHaveText("0")
    await page.getByTestId("fab").click()
    await expect(presses).toHaveText("1")
    await page.getByTestId("fab").click()
    await expect(presses).toHaveText("2")
  })
})
