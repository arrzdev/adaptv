import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The back chain — a back press is auctioned down a module-level registry, highest
 * band first, the newest registration first within a band, and the first handler
 * that returns true ends the walk (src/capabilities/back-chain.ts,
 * docs/design/coordination.md §2).
 *
 * The unit tests pin the registry on its own. What only a real page can show is the
 * wiring around it: that the lab's handlers, the shell's floor handler and the
 * components' handlers all land in ONE registry (a duplicated module would split
 * them silently, and every unit test would still pass), that React effects register
 * and unregister them in the order the chain relies on, and that a dropdown and a
 * drawer really close on back instead of the route popping out from under them.
 *
 * What presses back. The chain's real inputs are the Android hardware button and
 * `adaptvBack()`, which is the same `runBackChain()` call. A headless browser has no
 * hardware button, so a press is either the back-chain lab's own `runBackChain()`
 * button or `window.__adaptvBack` — the seam every LabPage installs, which is
 * `adaptvBack` itself. The seam is for the overlays: clicking an on-page button is an
 * outside press that dismisses a menu before the chain can, and a modal drawer's
 * overlay covers the page.
 *
 * What does NOT press back, read off the code rather than assumed: nothing listens
 * for Escape or popstate. In a tab the browser's own Back button is plain history
 * and Escape is each component's own business (the dropdown closes itself on it —
 * dropdown.spec.ts), so this spec pins both as non-inputs.
 */

const BACK_CHAIN = "/lab/back-chain"
const FLOOR_DEFERRED =
  "runBackChain() → nobody handled it (router back is the floor)"

/** Client-side navigation, so the router has an entry to pop. Link taps ride the
 *  gesture engine, which synthetic input does not drive (see link.spec.ts). */
async function navigateInApp(page: Page, to: string, heading: string) {
  await page.evaluate(async (path) => {
    const router = window.__TSR_ROUTER__
    if (!router) throw new Error("the app's router is not on window")
    await router.navigate({ to: path })
  }, to)
  await expect(page).toHaveURL(new RegExp(`${to}$`))
  await expect(
    page.getByRole("heading", { name: heading, level: 1 }),
  ).toBeVisible()
}

/** Land on `/lab` with the client driving it — the entry every back pops to. */
async function openLabIndex(page: Page) {
  await page.goto("/lab")
  await awaitClientHandover(page)
}

/** One back press through the seam; resolves to whether a handler consumed it. */
function pressBack(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const back = (window as unknown as { __adaptvBack?: () => boolean })
      .__adaptvBack
    if (!back)
      throw new Error("no window.__adaptvBack — is this a LabPage?")
    return back()
  })
}

/* ── the back-chain lab driver ─────────────────────────────────────────────── */

const labChain = {
  open: (page: Page, label: string) =>
    page.getByRole("button", { name: label, exact: true }).click(),
  run: (page: Page) =>
    page
      .getByRole("button", { name: "runBackChain()", exact: true })
      .click(),
  /** The `<label> registered` badge. */
  registered: (page: Page, label: string) =>
    page.getByText(`${label} registered`, { exact: true }).locator(".."),
  /** The log, newest first, without the timestamp each line carries. */
  log: async (page: Page) =>
    (await page.locator("[data-lab-log] li").allInnerTexts()).map((line) =>
      line.slice(line.indexOf(" · ") + 3),
    ),
}

/** The lab's fakes. The overlay and the menu register from a bare effect; the
 *  second overlay is a component mounted while open that registers through
 *  `useBackHandler`, so both registration paths have to leave the chain. */
const FAKES = {
  overlay: {
    button: "Open a fake overlay",
    row: "overlay",
    consumed: "Overlay (400) consumed the press",
  },
  secondOverlay: {
    button: "Open a second fake overlay",
    row: "second overlay",
    consumed: "Second overlay (400) consumed the press",
  },
  menu: {
    button: "Open a fake menu",
    row: "menu",
    consumed: "Transient (300) consumed the press",
  },
} as const

test.describe("the chain on its lab page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BACK_CHAIN)
    await awaitClientHandover(page)
  })

  test("the highest band consumes first, and the consumer ends the walk", async ({
    page,
  }) => {
    await labChain.open(page, FAKES.overlay.button)
    await labChain.open(page, FAKES.menu.button)
    await expect(
      labChain.registered(page, FAKES.overlay.row),
    ).toContainText("true")
    await expect(labChain.registered(page, FAKES.menu.row)).toContainText(
      "true",
    )

    await labChain.run(page)
    await expect(
      labChain.registered(page, FAKES.overlay.row),
    ).toContainText("false")
    await expect(labChain.registered(page, FAKES.menu.row)).toContainText(
      "true",
    )
    //nothing below the consumer ran: the two always-deferring handlers never logged
    expect(await labChain.log(page)).toEqual([
      "runBackChain() → consumed",
      FAKES.overlay.consumed,
    ])

    //the overlay unregistered when it closed, so the next press reaches the menu
    await labChain.run(page)
    await expect(labChain.registered(page, FAKES.menu.row)).toContainText(
      "false",
    )
    expect(await labChain.log(page)).toEqual([
      "runBackChain() → consumed",
      FAKES.menu.consumed,
      "runBackChain() → consumed",
      FAKES.overlay.consumed,
    ])
  })

  for (const [first, last] of [
    [FAKES.overlay, FAKES.secondOverlay],
    [FAKES.secondOverlay, FAKES.overlay],
  ] as const) {
    test(`within one band the newest registration consumes first (${first.row} then ${last.row})`, async ({
      page,
    }) => {
      await labChain.open(page, first.button)
      await expect(labChain.registered(page, first.row)).toContainText(
        "true",
      )
      await labChain.open(page, last.button)
      await expect(labChain.registered(page, last.row)).toContainText(
        "true",
      )

      await labChain.run(page)
      await expect(labChain.registered(page, last.row)).toContainText(
        "false",
      )
      await expect(labChain.registered(page, first.row)).toContainText(
        "true",
      )
      expect(await labChain.log(page)).toEqual([
        "runBackChain() → consumed",
        last.consumed,
      ])

      await labChain.run(page)
      await expect(labChain.registered(page, first.row)).toContainText(
        "false",
      )
      expect((await labChain.log(page)).slice(0, 2)).toEqual([
        "runBackChain() → consumed",
        first.consumed,
      ])
    })
  }

  test("a handler that declines passes the press down, and a tab with no history is left alone", async ({
    page,
  }) => {
    //a fresh document is the first history entry: the floor has nothing to pop and,
    //off native, defers rather than closing the tab
    await labChain.run(page)
    await expect(page.locator("[data-lab-log] li")).toHaveCount(3)
    expect(await labChain.log(page)).toEqual([
      FLOOR_DEFERRED,
      "useBackHandler (100) deferred",
      "Affordance (200) deferred",
    ])
    await expect(page).toHaveURL(new RegExp(`${BACK_CHAIN}$`))
  })
})

test.describe("the floor, and handlers leaving with their page", () => {
  test.beforeEach(async ({ page }) => {
    await openLabIndex(page)
    await navigateInApp(page, BACK_CHAIN, "Back chain")
  })

  test("with no overlay open, back pops the route", async ({ page }) => {
    await labChain.run(page)
    await expect(page).toHaveURL(/\/lab$/)
  })

  test("a page's handlers leave the chain when it unmounts", async ({
    page,
  }) => {
    //two handlers that consume every press, left registered as the page goes: one
    //from a bare registerBackHandler effect, one from useBackHandler
    await labChain.open(page, FAKES.overlay.button)
    await labChain.open(page, FAKES.secondOverlay.button)
    await expect(
      labChain.registered(page, FAKES.overlay.row),
    ).toContainText("true")
    await expect(
      labChain.registered(page, FAKES.secondOverlay.row),
    ).toContainText("true")

    await navigateInApp(page, "/lab/hooks", "Standalone hooks")
    await page
      .getByRole("button", { name: "adaptvBack()", exact: true })
      .click()

    //had it outlived its page it would have swallowed this press on /lab/hooks
    await expect(page).toHaveURL(new RegExp(`${BACK_CHAIN}$`))
    await expect(
      labChain.registered(page, FAKES.overlay.row),
    ).toContainText("false")
  })

  test("Escape and the browser's Back are not inputs to the chain", async ({
    page,
  }) => {
    await labChain.open(page, FAKES.overlay.button)
    await expect(
      labChain.registered(page, FAKES.overlay.row),
    ).toContainText("true")

    //An absence cannot be waited for, so the next real press is the oracle: had
    //Escape walked the chain, the overlay would already be closed and this press
    //would fall through to the floor and pop the route.
    await page.keyboard.press("Escape")
    await labChain.run(page)
    await expect(
      labChain.registered(page, FAKES.overlay.row),
    ).toContainText("false")
    expect(await labChain.log(page)).toEqual([
      "runBackChain() → consumed",
      FAKES.overlay.consumed,
    ])

    //plain history: it navigates with a consuming Overlay handler still registered
    await labChain.open(page, FAKES.overlay.button)
    await expect(
      labChain.registered(page, FAKES.overlay.row),
    ).toContainText("true")
    await page.goBack()
    await expect(page).toHaveURL(/\/lab$/)
    await expect(
      page.getByRole("heading", { name: "Testing", level: 1 }),
    ).toBeVisible()
  })
})

/* ── overlays built on the chain ───────────────────────────────────────────── */

/*
 * These open on a fresh document on purpose. It is the first history entry, so the
 * floor handler has nothing to pop and defers in a tab — which makes the press's
 * return value the oracle: `true` can only mean the overlay itself consumed it. With
 * an entry behind the page the floor would ALSO return true, and telling "the menu
 * closed" apart from "the route popped and took the menu with it" would come down to
 * racing an asynchronous history.back(). The floor's own pop is pinned above.
 */
test.describe("overlays consume the press instead of the router", () => {
  test("an open dropdown closes on back, and closed it defers", async ({
    page,
  }) => {
    await page.goto("/lab/dropdown")
    await awaitClientHandover(page)
    const menu = page.locator('[data-adaptv="dropdown"]')
    await page
      .getByRole("button", { name: "Actions", exact: true })
      .click()
    await expect(menu).toBeVisible()

    expect(await pressBack(page), "the open menu consumes the press").toBe(
      true,
    )
    await expect(menu).toHaveCount(0)

    expect(await pressBack(page), "a closed menu defers").toBe(false)
    await expect(page).toHaveURL(/\/lab\/dropdown$/)
  })

  test("stacked drawers close innermost first, and closed they defer", async ({
    page,
  }) => {
    await page.goto("/lab/drawer")
    await awaitClientHandover(page)
    const outer = page.getByRole("button", {
      name: "Open the inner drawer",
      exact: true,
    })
    const inner = page.getByText("Back or the overlay must close THIS one")

    await page
      .getByRole("button", { name: "Open nested drawer", exact: true })
      .click()
    await outer.click()
    await expect(inner).toBeVisible()

    expect(await pressBack(page), "the inner drawer consumes").toBe(true)
    await expect(inner).toBeHidden()
    await expect(outer).toBeVisible()

    expect(await pressBack(page), "then the outer drawer consumes").toBe(
      true,
    )
    await expect(outer).toBeHidden()

    expect(await pressBack(page), "closed drawers defer").toBe(false)
    await expect(page).toHaveURL(/\/lab\/drawer$/)
  })
})
