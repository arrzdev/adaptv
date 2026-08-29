import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * `chromeTint` on a route — the colour the browser's chrome takes for one screen.
 *
 * The claim under test is a TIMING one: the colour is right on the first frame of a cold launch,
 * not shortly after it. That is the whole reason the value is scanned out of the route file at
 * build time and inlined into the pre-paint script instead of being read off the route object,
 * so a test that only checks the settled page would pass against an implementation that flashes
 * the theme colour first and proves nothing.
 *
 * So the first test HOLDS THE BUNDLE. Every script request is stalled, the DOM is read while the
 * app provably cannot have run, and only then is the page released. There is no polling and no
 * race: if the colour is there, it was put there by the head script.
 *
 * ⚠︎ As in `chrome-tint.spec.ts`: the toolbar a user looks at is painted by the browser PROCESS
 * and is not in the page. What Playwright can read is the two things adaptv writes — the meta tag
 * (Android/Chrome, iOS <= 18) and the html background (iOS 26+, where the tag is inert). Both are
 * asserted everywhere below, because a change that keeps one and drops the other is invisible
 * from either side alone.
 */

test.use({ viewport: { width: 390, height: 844 } })

/** Declared by `/lab/route-tint`, and deliberately neither theme colour. */
const ROUTE_TINT = "#0b6e4f"
const ROUTE_TINT_RGB = "rgb(11, 110, 79)"

/** The two surfaces, read together. */
async function chrome(page: Page) {
  return page.evaluate(() => ({
    meta:
      document
        .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content?.toLowerCase() ?? null,
    html: getComputedStyle(document.documentElement).backgroundColor,
  }))
}

async function awaitClientHandover(page: Page) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
}

test("the colour is on screen before the app can have booted", async ({
  page,
}) => {
  //Stall every script. The document and its inline head script still run — that is
  //the point — but nothing that could hydrate does.
  const held: Array<() => void> = []
  await page.route("**/*.js", async (route) => {
    await new Promise<void>((release) => held.push(release))
    await route.continue()
  })
  await page.route("**/*.tsx", async (route) => {
    await new Promise<void>((release) => held.push(release))
    await route.continue()
  })

  await page.goto("/lab/route-tint", { waitUntil: "commit" })
  await expect.poll(async () => (await chrome(page)).meta).toBe(ROUTE_TINT)

  const painted = await chrome(page)
  expect(painted.html).toBe(ROUTE_TINT_RGB)
  //and prove the app really had not run — otherwise this test would pass for the
  //wrong reason and quietly stop guarding the thing it exists for
  expect(await page.evaluate(() => Boolean(window.__TSR_ROUTER__))).toBe(
    false,
  )

  for (const release of held) release()
})

test.describe("once the app is running", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/route-tint")
    await awaitClientHandover(page)
  })

  test("keeps the route's colour on both surfaces", async ({ page }) => {
    expect(await chrome(page)).toEqual({
      meta: ROUTE_TINT,
      html: ROUTE_TINT_RGB,
    })
  })

  test("does not follow a theme flip — one colour, both themes", async ({
    page,
  }) => {
    const before = await chrome(page)
    await page.evaluate(() => {
      const root = document.documentElement
      const dark = root.classList.contains("dark")
      root.classList.remove("light", "dark")
      root.classList.add(dark ? "light" : "dark")
    })
    await expect
      .poll(async () => (await chrome(page)).meta)
      .toBe(ROUTE_TINT)
    expect((await chrome(page)).html).toBe(before.html)
  })

  test("hands the chrome back to the THEME on the way out, not to the layout above", async ({
    page,
  }) => {
    //`/lab` sits under the same providers layout and declares no tint of its own.
    //If leaving landed on a parent's tint instead of the app's theme colour, this
    //is where it would show.
    await page.getByRole("link", { name: "/lab · no tint" }).click()
    await expect(page).toHaveURL(/\/lab$/)
    await expect
      .poll(async () => (await chrome(page)).meta)
      .not.toBe(ROUTE_TINT)

    const themed = await chrome(page)
    const configured = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    )
    //the app's own theme colours, from adaptv.config.ts
    expect(themed.meta).toBe(configured ? "#1e0033" : "#f5e6ff")
  })

  test("takes the colour back on the way in", async ({ page }) => {
    await page.getByRole("link", { name: "/lab · no tint" }).click()
    await expect(page).toHaveURL(/\/lab$/)
    await expect
      .poll(async () => (await chrome(page)).meta)
      .not.toBe(ROUTE_TINT)

    await page.goBack()
    await expect(page).toHaveURL(/\/lab\/route-tint$/)
    await expect
      .poll(async () => (await chrome(page)).meta)
      .toBe(ROUTE_TINT)
    expect((await chrome(page)).html).toBe(ROUTE_TINT_RGB)
  })
})
