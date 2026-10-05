import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The hover:/active: corrections on a stylesheet with no Tailwind in it
 * (`/lab/plain-css`, styled by `plain-css.css`). adaptv's post-processor
 * (`src/vite/css-patch-rewrite.ts`) rewrites those rules in the served CSS; this
 * spec is the proof a pointer sees the result, under touch emulation on both
 * engines. It is emulation, not a finger: the real-device walk is owed in
 * `docs/roadmap/owed-device-verification.md`.
 */

const REST = "rgb(240, 240, 240)"
const HOVER = "rgb(255, 0, 0)"
const PRESSED = "rgb(0, 128, 0)"

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
})

test.describe("plain CSS, touch", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/plain-css")
    await awaitClientHandover(page)
  })

  const bg = (locator: import("@playwright/test").Locator) =>
    locator.evaluate((el) => getComputedStyle(el).backgroundColor)

  test("the emulated screen has no hover-capable pointer", async ({ page }) => {
    //the premise every assertion below rests on
    expect(
      await page.evaluate(() => matchMedia("(hover: hover)").matches),
    ).toBe(false)
  })

  test("a tap leaves no sticky hover on a hand-written :hover rule", async ({
    page,
  }) => {
    const tile = page.getByText("tap me (plain CSS)", { exact: true })
    await tile.tap()
    expect(await bg(tile)).toBe(REST)
  })

  test("inside data-adaptv-no-hover the rule is stock :hover again", async ({
    page,
  }) => {
    //the hatch: the same rule, unwrapped for this subtree, so it matches whenever
    //the engine reports :hover — forced here, because a tap's hover is a UA choice
    const tile = page.getByText("tap me (opted out)", { exact: true })
    const corrected = page.getByText("tap me (plain CSS)", { exact: true })
    await tile.hover()
    expect(await bg(tile)).toBe(HOVER)
    await corrected.hover()
    expect(await bg(corrected)).toBe(REST)
  })

  test("a hand-written :active rule follows the engine's data-pressed", async ({
    page,
  }) => {
    const press = page.getByText("hold me (plain CSS :active)", {
      exact: true,
    })
    await expect(press).toHaveAttribute("data-press-engine", "")
    await press.scrollIntoViewIfNeeded()
    const box = await press.boundingBox()
    if (!box) throw new Error("the pressable has no box")
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2

    await page.mouse.move(x, y)
    await page.mouse.down()
    await expect.poll(() => bg(press)).toBe(PRESSED)
    await expect(press).toHaveAttribute("data-pressed", "")

    //drag off: the engine drops data-pressed, and native :active — which would
    //hold while the button is down — is excluded on an engine element
    await page.mouse.move(x, y + 400)
    await expect.poll(() => bg(press)).toBe(REST)

    //slide back in: reentrant, which native :active cannot be
    await page.mouse.move(x, y)
    await expect.poll(() => bg(press)).toBe(PRESSED)

    await page.mouse.up()
    await expect.poll(() => bg(press)).toBe(REST)
  })
})
