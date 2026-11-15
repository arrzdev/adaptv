import { expect, type Locator, type Page, test } from "@playwright/test"

//Every sheet and menu on the site, driven from the keyboard only, at a phone and a desktop
//width. A modal dialog owes (WAI-ARIA APG): focus moves in on open, Tab and Shift+Tab stay
//inside, Escape closes, focus goes back to what opened it (WCAG 2.4.3). A menu owes the same
//minus the Tab trap: Tab leaves a menu and closes it, so arrows are what is held inside.
//
//The overlays: the docs menu (a phone only: on a desktop the sidebar is part of the page,
//and its search field sits inside that sheet), the landing's "Open the sheet" demo, the
//Drawer example on /docs/drawer and the Dropdown example on /docs/dropdown. The sheets are the
//framework's Drawer behind a plain button with a controlled `open`; Drawer.Content is
//`role="dialog" aria-modal="true"`. Before the fix (#503) focus stayed on <body>, three Tabs
//reached the page behind, and Escape left focus on the page.

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 800 },
]
const STOPS = 12

//an open drawer is the dialog that is not aria-hidden; a closed one stays mounted for its exit
function openDialog(page: Page) {
  return page.locator('[role="dialog"][aria-hidden="false"]')
}

function focusIsInside(surface: Locator) {
  return surface.evaluate(
    (el) => document.activeElement !== document.body && el.contains(document.activeElement),
  )
}

/** Hydration finished: before it a keypress on the trigger opens nothing. */
async function load(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator("h1").first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState("networkidle")
}

/** Focuses the trigger and opens it with Enter, never a click. Focus must be inside on open. */
async function opensWithFocus(page: Page, trigger: Locator, surface: Locator) {
  await trigger.scrollIntoViewIfNeeded()
  await trigger.focus()
  await page.keyboard.press("Enter")
  //one Enter opens it, on screen (the sweep once saw the first Enter mount it below the fold)
  await expect(surface).toHaveCount(1)
  await expect(surface).toBeInViewport()
  await expect.poll(() => focusIsInside(surface)).toBe(true)
}

async function tabStaysInside(page: Page, surface: Locator) {
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 1; i <= STOPS; i++) {
      await page.keyboard.press(key)
      expect(await focusIsInside(surface), `after ${key} #${i}`).toBe(true)
    }
  }
}

async function escapeReturns(page: Page, trigger: Locator, surface: Locator) {
  await page.keyboard.press("Escape")
  await expect(surface).toHaveCount(0)
  await expect(trigger).toBeFocused()
}

const SHEETS = [
  {
    name: "landing sheet",
    path: "/",
    viewports: VIEWPORTS,
    trigger: (page: Page) => page.getByRole("button", { name: "Open the sheet", exact: true }),
  },
  {
    name: "docs drawer example",
    path: "/docs/drawer",
    viewports: VIEWPORTS,
    trigger: (page: Page) => page.getByRole("button", { name: "Open the drawer", exact: true }),
  },
  {
    //the trigger is named for the page it sits on
    name: "docs menu",
    path: "/docs/button",
    viewports: [VIEWPORTS[0]],
    trigger: (page: Page) => page.getByRole("button", { name: "Button", exact: true }),
  },
]

for (const sheet of SHEETS) {
  for (const viewport of sheet.viewports) {
    test(`${sheet.name} (${viewport.name}): focus moves in, Tab stays inside, Escape returns it to the button`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await load(page, sheet.path)
      const trigger = sheet.trigger(page).first()
      const dialog = openDialog(page)
      await opensWithFocus(page, trigger, dialog)
      await tabStaysInside(page, dialog)
      await escapeReturns(page, trigger, dialog)
    })
  }
}

//the docs menu holds the site search: it has to work and stay in the sheet while it filters
test("docs menu (390): the search results stay inside the sheet", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS[0])
  await load(page, "/docs/button")
  const trigger = page.getByRole("button", { name: "Button", exact: true }).first()
  const dialog = openDialog(page)
  await opensWithFocus(page, trigger, dialog)
  await dialog.getByPlaceholder("Search the docs").fill("drawer")
  await expect(dialog.getByRole("link", { name: /Drawer/ }).first()).toBeVisible()
  await tabStaysInside(page, dialog)
  await escapeReturns(page, trigger, dialog)
})

//the Dropdown example: Escape works today, focus moving into the menu does not
for (const viewport of VIEWPORTS) {
  test(`docs dropdown example (${viewport.name}): Escape closes it and returns focus to the button`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await load(page, "/docs/dropdown")
    const trigger = page.getByRole("button", { name: "File actions" })
    const menu = page.getByRole("menu", { name: "File actions" })
    await trigger.focus()
    await page.keyboard.press("Enter")
    await expect(menu).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(menu).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  //KNOWN FAILURE (TUD-5644): Dropdown is role="menu" but moves no focus into it and has no
  //arrow keys. The test must fail until that is fixed; then delete the test.fail line.
  test(`docs dropdown example (${viewport.name}): focus moves to the menu and arrows stay in it`, async ({
    page,
  }) => {
    test.fail(true, "open bug TUD-5644: the menu never takes focus")
    await page.setViewportSize(viewport)
    await load(page, "/docs/dropdown")
    const trigger = page.getByRole("button", { name: "File actions" })
    const menu = page.getByRole("menu", { name: "File actions" })
    await opensWithFocus(page, trigger, menu)
    for (const key of ["ArrowDown", "ArrowDown", "ArrowUp", "End", "Home"]) {
      await page.keyboard.press(key)
      expect(await focusIsInside(menu), `after ${key}`).toBe(true)
    }
    await escapeReturns(page, trigger, menu)
  })
}
