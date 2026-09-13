import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Skeleton — a placeholder the size of the thing that has not arrived. What a
 * headless browser can verify is the whole accessibility contract and the two
 * OS-setting responses, because both are emulatable per browser context:
 *
 *   - a block is stamped `data-adaptv="skeleton"` and `aria-hidden="true"`, so a
 *     screen reader never reads an empty grey box;
 *   - `Skeleton.Region` is `aria-busy` with ONE visually hidden `role=status`
 *     line carrying the label while it loads; once its children are real the
 *     attribute is removed (not set to false), the status line is emptied (not
 *     unmounted), and the content is visible;
 *   - under `prefers-reduced-motion: reduce` the shimmer's computed
 *     `animation-name` is `none`, where the default context reports a real one;
 *   - under `forced-colors: active` the block keeps a 1px solid border, so a
 *     high-contrast theme that throws the fill away still shows the box.
 *
 * NOT here: whether the shimmer LOOKS right, and the iOS/Android settings that
 * flip the queries live — those are walked on the simulator against the page's
 * own readout.
 *
 * The two media conditions are set with `page.emulateMedia()` BEFORE the
 * navigation, not with `test.use({ reducedMotion, forcedColors })` on the
 * describe. In this harness (Playwright 1.61.1, both projects) the context
 * options never reach the page — `matchMedia` reports `false` for both on
 * `about:blank` and on the route — while the page-level call is honoured on
 * chromium and webkit alike. Applied before `goto`, it is still the engine
 * answering the query on the first style resolution, which is the property
 * under test (no JS in the loop, no hydration gap).
 */

const PLACEHOLDER = '[data-adaptv="skeleton"]'

/**
 * Wait for the client to take over before pressing anything.
 *
 * The region and its toggle are server-rendered, so a `waitFor()` on the rows
 * is satisfied by inert HTML: a click fired in that window lands on a button
 * whose handler is not attached yet, `loading` never flips, and the assertion
 * reads the page's initial state. It is not load flake — Playwright boots its
 * own dev server and tears it down per run, so the FIRST test to reach this
 * route pays the cold transform cost and loses the race while every test
 * after it wins. A dev session left running hides it, because
 * `reuseExistingServer` then hands the suite a warm server.
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

async function openLab(page: Page) {
  await page.goto("/lab/skeleton")
  await awaitClientHandover(page)
  await page.getByTestId("skeleton-row").first().waitFor()
}

/** The shimmer's own word on whether it runs: the computed animation name. */
function animationName(page: Page) {
  return page
    .getByTestId("skeleton-row")
    .first()
    .evaluate((el) => getComputedStyle(el).animationName)
}

test.describe("Skeleton", () => {
  test.beforeEach(async ({ page }) => {
    await openLab(page)
  })

  test("a placeholder block is stamped and hidden from assistive tech", async ({
    page,
  }) => {
    const rows = page.getByTestId("skeleton-row")
    // the card mock: three rows of circle + two lines
    await expect(rows).toHaveCount(9)
    for (const row of await rows.all()) {
      await expect(row).toHaveAttribute("data-adaptv", "skeleton")
      await expect(row).toHaveAttribute("aria-hidden", "true")
      // a placeholder has nothing to say — no text, no children of its own
      await expect(row).toHaveText("")
    }
  })

  test("the region is busy and announces once while loading, then hands over", async ({
    page,
  }) => {
    const region = page.getByTestId("skeleton-region")
    const readout = page.getByTestId("skeleton-readout")

    await expect(region).toHaveAttribute("data-adaptv", "skeleton-region")
    await expect(region).toHaveAttribute("aria-busy", "true")
    // exactly one status line, carrying the label — the boxes inside are
    // aria-hidden, so this is the only thing a screen reader hears
    const status = region.getByRole("status")
    await expect(status).toHaveCount(1)
    await expect(status).toHaveText("Loading tasks")
    await expect(region.locator(PLACEHOLDER).first()).toBeVisible()
    await expect(page.getByTestId("skeleton-content")).toHaveCount(0)
    await expect(readout).toContainText("loading: true")
    // the lab tells a tester nothing may move on the swap, so the region's
    // own box is the number: the placeholders must reserve the loaded height
    const heightWhileLoading = await region.evaluate(
      (el) => el.getBoundingClientRect().height,
    )

    await page.getByTestId("skeleton-toggle").click()

    // removed, not set to "false": no stale attribute stays on the region
    await expect(region).not.toHaveAttribute("aria-busy")
    // the live region stays MOUNTED and is emptied — a screen reader announces
    // changes to an existing live region, and one that mounts with its text
    // already inside is not reliably read, so the element is the same node in
    // both states and only its text goes
    await expect(status).toHaveCount(1)
    await expect(status).toHaveText("")
    await expect(page.getByTestId("skeleton-content")).toBeVisible()
    await expect(
      page.getByTestId("skeleton-content").getByRole("listitem"),
    ).toHaveCount(3)
    // the inline swap rendered its child with no wrapper left behind
    await expect(region.locator(PLACEHOLDER)).toHaveCount(0)
    await expect(
      region.getByText("3 tasks · synced just now"),
    ).toBeVisible()
    await expect(readout).toContainText("loading: false")
    expect(
      await region.evaluate((el) => el.getBoundingClientRect().height),
    ).toBeCloseTo(heightWhileLoading, 1)
  })

  test("the shimmer runs by default", async ({ page }) => {
    // the control for the reduced-motion describe below: a real keyframes
    // name here, `none` there, on the same element
    expect(await animationName(page)).not.toBe("none")
    await expect(page.getByTestId("skeleton-readout")).toContainText(
      "reduced-motion: false",
    )
  })
})

test.describe("Skeleton under prefers-reduced-motion", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openLab(page)
  })

  test("the shimmer stops — the computed animation-name is none", async ({
    page,
  }) => {
    await expect(page.getByTestId("skeleton-readout")).toContainText(
      "reduced-motion: true",
    )
    expect(await animationName(page)).toBe("none")
    // still a box: reduce-motion removes the movement, never the placeholder
    await expect(page.getByTestId("skeleton-row").first()).toBeVisible()
  })
})

test.describe("Skeleton under forced-colors", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" })
    await openLab(page)
  })

  test("the block keeps a visible 1px border", async ({ page }) => {
    await expect(page.getByTestId("skeleton-readout")).toContainText(
      "forced-colors: true",
    )
    const row = page.getByTestId("skeleton-row").first()
    const border = await row.evaluate((el) => {
      const s = getComputedStyle(el)
      return {
        width: s.borderTopWidth,
        style: s.borderTopStyle,
        // WebKit does not implement `forced-color-adjust` at all — the
        // computed property is `undefined` there, not "auto" — so the
        // opt-out is only assertable where the engine knows the property
        adjust: CSS.supports("forced-color-adjust", "none")
          ? s.forcedColorAdjust
          : "unsupported",
      }
    })
    expect(border.width).toBe("1px")
    expect(border.style).toBe("solid")
    // the fill is exempted from the forced palette so the box is not blanked
    // to the canvas colour — the border is what stays visible either way
    expect(["none", "unsupported"]).toContain(border.adjust)
  })
})
