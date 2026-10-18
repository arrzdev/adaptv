import { expect, type Locator, type Page, test } from "@playwright/test"

//The site's two sheets, driven from the keyboard only: the docs menu on a phone and the
//landing's "Open the sheet" demo on a desktop. Both are the framework's Drawer behind a plain
//button with a controlled `open`, and Drawer.Content is `role="dialog" aria-modal="true"`, so
//each owes what a modal dialog owes (WAI-ARIA APG): focus moves in on open, Tab and Shift+Tab
//stay inside, Escape closes, focus goes back to the button that opened it. Before the fix focus
//stayed on <body>, three Tabs reached the page behind, and Escape left focus on the page.

const SHEETS = [
  {
    name: "docs menu",
    path: "/docs/button",
    viewport: { width: 390, height: 844 },
    trigger: (page: Page) => page.getByRole("button", { name: "Button", exact: true }),
  },
  {
    name: "landing sheet",
    path: "/",
    viewport: { width: 1280, height: 800 },
    trigger: (page: Page) => page.getByRole("button", { name: "Open the sheet", exact: true }),
  },
]

//an open drawer is the dialog that is not aria-hidden; a closed one stays mounted for its exit
function openDialog(page: Page) {
  return page.locator('[role="dialog"][aria-hidden="false"]')
}

function focusIsInside(dialog: Locator) {
  return dialog.evaluate((el) => el.contains(document.activeElement))
}

for (const sheet of SHEETS) {
  test(`${sheet.name}: focus moves in, Tab stays inside, Escape returns it to the button`, async ({
    page,
  }) => {
    await page.setViewportSize(sheet.viewport)
    await page.goto(sheet.path)
    await page.evaluate(() => document.fonts.ready)

    const trigger = sheet.trigger(page).first()
    await trigger.scrollIntoViewIfNeeded()
    await trigger.focus()
    await page.keyboard.press("Enter")

    //one Enter opens it, on screen (the sweep once saw the first Enter mount it below the fold)
    const dialog = openDialog(page)
    await expect(dialog).toHaveCount(1)
    await expect(dialog).toBeInViewport()
    await expect.poll(() => focusIsInside(dialog)).toBe(true)

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Tab")
      expect(await focusIsInside(dialog), `after Tab ${i + 1}`).toBe(true)
    }
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Shift+Tab")
      expect(await focusIsInside(dialog), `after Shift+Tab ${i + 1}`).toBe(true)
    }

    await page.keyboard.press("Escape")
    await expect(openDialog(page)).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })
}
