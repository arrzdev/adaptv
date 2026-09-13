import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import {
  card,
  createTask,
  drawer,
  expectDrawerGone,
  holdToConfirm,
  pressChip,
  pressControlAndCarry,
  TUTORIAL_DECK,
  taskCounts,
} from "./support/tasks-app"

/*
 * The app's settings screen and the decks it manages, walked end to end.
 * The drivers and why each one was chosen live in `support/tasks-app.ts`.
 *
 * Two of these hold a destructive button for its real duration (5 s for a deck,
 * 10 s for all data). That is the gesture a user performs, so it is not shortened.
 */

test.use({ viewport: { width: 390, height: 844 } })

/** Load a route and wait until React is driving it. */
async function openApp(page: Page, path = "/") {
  await page.goto(path)
  await awaitClientHandover(page)
}

/** Reload — the local store and the view preferences must survive it. */
async function reloadApp(page: Page) {
  await page.reload()
  await awaitClientHandover(page)
}

/** The deck rows in Settings, top to bottom, as "emoji name". */
function settingsDeckNames(page: Page) {
  return page
    .locator("ul")
    .filter({ has: page.getByRole("button", { name: /^Edit / }) })
    .locator("li")
    .allInnerTexts()
    .then((rows) => rows.map((row) => row.replace(/\s+/g, " ").trim()))
}

async function createDeck(page: Page, name: string, emoji: string) {
  await page.getByRole("button", { name: "New deck" }).click()
  const sheet = drawer(page)
  await sheet.getByLabel("Deck name").fill(name)
  await pressChip(sheet, `Emoji ${emoji}`)
  await sheet.getByRole("button", { name: "Create", exact: true }).click()
  await expectDrawerGone(page, "a created deck closes its drawer")
}

async function goToTasks(page: Page) {
  await page.getByRole("button", { name: "Back to tasks" }).click()
  await expect(
    page.getByRole("heading", { level: 1, name: "Your tasks" }),
  ).toBeVisible()
}

async function goToSettings(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click()
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible()
}

test.describe("settings and decks", () => {
  test("a new deck becomes a tab that filters the list to its own tasks", async ({
    page,
  }) => {
    await openApp(page, "/settings")
    await expect
      .poll(() => settingsDeckNames(page))
      .toEqual(["🪜 Tutorial"])
    //the only deck cannot be reordered, so its row is not a sortable item: no
    //tab stop that Space cannot pick up, no drag instructions read to a screen
    //reader. A second deck makes both rows sortable, which is the control
    const tutorialRow = page
      .getByRole("listitem")
      .filter({ hasText: "Tutorial" })
    await expect(
      tutorialRow,
      "a row that cannot be dragged is not announced as sortable",
    ).not.toHaveAttribute("aria-roledescription")
    await expect(
      tutorialRow,
      "a row that cannot be dragged is not a tab stop",
    ).not.toHaveAttribute("tabindex")
    await createDeck(page, "Groceries", "🛒")
    await expect
      .poll(() => settingsDeckNames(page))
      .toEqual(["🪜 Tutorial", "🛒 Groceries"])
    await expect(tutorialRow).toHaveAttribute(
      "aria-roledescription",
      "sortable",
    )
    await expect(tutorialRow).toHaveAttribute("tabindex", "0")

    //Enter on a row's button opens that deck. It must not ALSO pick the row up
    //for a keyboard drag — which dims the list behind the sheet, announces a
    //drag to a screen reader, and turns the next arrow key into a reorder
    await page.getByRole("button", { name: "Edit Groceries" }).focus()
    await page.keyboard.press("Enter")
    await expect(drawer(page).getByLabel("Deck name")).toHaveValue(
      "Groceries",
    )
    await expect(
      page.getByText(/picked up draggable item|over droppable area/i),
      "a key press on a row's button must not start dragging the row",
    ).toHaveCount(0)
    await drawer(page).getByRole("button", { name: "Cancel" }).click()
    await expectDrawerGone(page, "Cancel closes the deck form")

    await goToTasks(page)
    await createTask(page, { title: "Buy oat milk", deck: "🛒 Groceries" })
    await createTask(page, { title: "Finish the tutorial" })
    await expect(taskCounts(page)).toHaveText(/2 pending/)

    await page
      .getByRole("button", { name: "🛒 Groceries", exact: true })
      .click()
    await expect(
      page.getByRole("heading", { level: 1, name: "Groceries" }),
    ).toBeVisible()
    await expect(card(page, "Buy oat milk")).toBeVisible()
    await expect(card(page, "Finish the tutorial")).toHaveCount(0)
    await expect(taskCounts(page)).toHaveText(/1 pending/)

    //the chosen deck is a stored view preference
    await reloadApp(page)
    await expect(
      page.getByRole("heading", { level: 1, name: "Groceries" }),
    ).toBeVisible()
    await expect(card(page, "Buy oat milk")).toBeVisible()
    await expect(card(page, "Finish the tutorial")).toHaveCount(0)

    await page
      .getByRole("button", { name: TUTORIAL_DECK, exact: true })
      .click()
    await expect(card(page, "Finish the tutorial")).toBeVisible()
    await expect(card(page, "Buy oat milk")).toHaveCount(0)

    await page.getByRole("button", { name: "All", exact: true }).click()
    await expect(card(page, "Buy oat milk")).toBeVisible()
    await expect(card(page, "Finish the tutorial")).toBeVisible()
  })

  test("dragging a deck in Settings reorders the deck tabs, and persists", async ({
    page,
  }) => {
    await openApp(page, "/settings")
    await createDeck(page, "Errands", "🛒")
    await expect
      .poll(() => settingsDeckNames(page))
      .toEqual(["🪜 Tutorial", "🛒 Errands"])

    //a press that lands on a row's Edit button and is carried onto the other row
    //is a press on the button, not a grab of the row: the order must not change.
    //The real drag below is the proof: from [Tutorial, Errands] it gives
    //[Errands, Tutorial], but had this press already reordered, it would carry
    //Errands back down and end in [Tutorial, Errands]
    await pressControlAndCarry(
      page,
      page.getByRole("button", { name: "Edit Errands" }),
      page.getByRole("listitem").filter({ hasText: "Tutorial" }),
    )
    await expect(
      drawer(page),
      "a press carried off the Edit button does not open the deck",
    ).toHaveCount(0)

    //grab the row by the deck's name, the part of the row that is not a
    //control, move past the 8px activation distance, carry it over the first
    //row and drop
    const from = await page
      .getByRole("listitem")
      .filter({ hasText: "Errands" })
      .boundingBox()
    const to = await page
      .getByRole("listitem")
      .filter({ hasText: "Tutorial" })
      .boundingBox()
    if (!from || !to) throw new Error("a deck row has no layout box")
    const x = from.x + 60
    const y = from.y + from.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y - 10, { steps: 3 })
    await page.mouse.move(x, to.y + 5, { steps: 15 })
    await page.mouse.up()
    await expect
      .poll(() => settingsDeckNames(page), {
        message:
          "the drop reorders, once: the Edit press before it must not have",
      })
      .toEqual(["🛒 Errands", "🪜 Tutorial"])

    await reloadApp(page)
    await expect
      .poll(() => settingsDeckNames(page), {
        message: "the order is stored",
      })
      .toEqual(["🛒 Errands", "🪜 Tutorial"])
    await goToTasks(page)
    await expect(
      page.getByRole("button", { name: /^(All|🛒 Errands|🪜 Tutorial)$/ }),
      "the tabs follow the deck order",
    ).toHaveText(["All", "🛒 Errands", "🪜 Tutorial"])
  })

  test("dark mode and the animations preference survive a reload", async ({
    page,
  }) => {
    await openApp(page, "/settings")
    const dark = page.getByRole("switch", { name: "Dark mode" })
    const animations = page.getByRole("switch", { name: "Animations" })
    await expect(dark).not.toBeChecked()
    await expect(animations).toBeChecked()

    await dark.focus()
    await page.keyboard.press("Space")
    await expect(dark).toBeChecked()
    await expect(page.locator("html")).toHaveClass(/\bdark\b/)
    await animations.focus()
    await page.keyboard.press("Space")
    await expect(animations).not.toBeChecked()

    await reloadApp(page)
    await expect(page.locator("html")).toHaveClass(/\bdark\b/)
    await expect(
      page.getByRole("switch", { name: "Dark mode" }),
    ).toBeChecked()
    await expect(
      page.getByRole("switch", { name: "Animations" }),
    ).not.toBeChecked()
  })

  test("renaming a deck renames it everywhere, and persists", async ({
    page,
  }) => {
    await openApp(page, "/settings")
    const edit = page.getByRole("button", { name: "Edit Tutorial" })
    //a lone deck can't be dragged, and dnd-kit marks its row aria-disabled —
    //which every control inside inherits, so a screen reader read this button
    //as unavailable while a tap still worked
    await expect(
      edit,
      "a deck that cannot be reordered must still expose its actions as enabled",
    ).toBeEnabled()
    await edit.click()
    const sheet = drawer(page)
    const name = sheet.getByLabel("Deck name")
    await expect(name, "the form opens on the deck").toHaveValue(
      "Tutorial",
    )
    await name.fill("Home")
    await pressChip(sheet, "Emoji 🏠")
    await sheet.getByRole("button", { name: "Save", exact: true }).click()
    await expectDrawerGone(page, "a saved deck closes its drawer")
    await expect.poll(() => settingsDeckNames(page)).toEqual(["🏠 Home"])

    await reloadApp(page)
    await expect.poll(() => settingsDeckNames(page)).toEqual(["🏠 Home"])
    await goToTasks(page)
    await expect(
      page.getByRole("button", { name: "🏠 Home", exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: TUTORIAL_DECK, exact: true }),
    ).toHaveCount(0)
  })

  test("deleting a deck takes its tasks with it, and the last deck cannot be deleted", async ({
    page,
  }) => {
    //the confirm is a real 5 s hold on top of a cold load and the setup, and the
    //test measured 16-21 s against the default 30 s budget, so it gets triple
    test.slow()
    await openApp(page, "/settings")
    await expect(
      page.getByRole("button", { name: "Delete Tutorial" }),
      "the only deck has no delete action",
    ).toHaveCount(0)
    await createDeck(page, "Work", "💼")

    await goToTasks(page)
    await createTask(page, { title: "Send the report", deck: "💼 Work" })
    await createTask(page, { title: "Stretch" })
    await expect(taskCounts(page)).toHaveText(/2 pending/)

    await goToSettings(page)
    await page.getByRole("button", { name: "Delete Work" }).click()
    const sheet = drawer(page)
    await expect(sheet).toContainText(
      "This permanently removes the deck and its 1 pending task and 0 archived tasks.",
    )
    await holdToConfirm(
      sheet.getByRole("button", { name: "Hold 5s to delete deck" }),
      sheet,
    )
    await expect
      .poll(() => settingsDeckNames(page))
      .toEqual(["🪜 Tutorial"])
    await expect(
      page.getByRole("button", { name: "Delete Tutorial" }),
      "once it is the last deck again, it loses its delete action",
    ).toHaveCount(0)

    await goToTasks(page)
    await expect(card(page, "Send the report")).toHaveCount(0)
    await expect(card(page, "Stretch")).toBeVisible()
    await expect(taskCounts(page)).toHaveText(/1 pending/)
    await reloadApp(page)
    await expect(card(page, "Send the report")).toHaveCount(0)
    await expect(taskCounts(page)).toHaveText(/1 pending/)
  })

  test("delete data wipes every deck and task, reseeds, and keeps the preferences", async ({
    page,
  }) => {
    //the confirm is a real 10 s hold on top of a cold load and the setup, and
    //the test measured 16-21 s against the default 30 s budget, so it gets triple
    test.slow()
    await openApp(page)
    await createTask(page, { title: "Something to lose" })
    await goToSettings(page)
    await createDeck(page, "Travel", "✈️")

    //a preference the drawer promises to keep
    const haptics = page.getByRole("switch", { name: "Haptics" })
    await expect(haptics).toBeChecked()
    await haptics.focus()
    await page.keyboard.press("Space")
    await expect(haptics).not.toBeChecked()

    await page.getByRole("button", { name: "Delete data" }).click()
    const sheet = drawer(page)
    await expect(sheet).toContainText(
      "This permanently removes 2 decks and 1 task from this device.",
    )
    await holdToConfirm(
      sheet.getByRole("button", { name: "Hold 10s to delete all data" }),
      sheet,
    )
    await expect
      .poll(() => settingsDeckNames(page), {
        message: "every deck goes and the first-run deck comes back",
      })
      .toEqual(["🪜 Tutorial"])

    await reloadApp(page)
    await expect
      .poll(() => settingsDeckNames(page))
      .toEqual(["🪜 Tutorial"])
    await expect(
      page.getByRole("switch", { name: "Haptics" }),
      "preferences survive a data wipe",
    ).not.toBeChecked()
    await goToTasks(page)
    await expect(taskCounts(page)).toHaveText(/0 pending\s*•\s*0 archived/)
    await expect(
      page.getByText("Tap + Create to create your first task."),
    ).toBeVisible()
  })

  test("the sign-in form needs both fields, then says there is no account to sign in to", async ({
    page,
  }) => {
    await openApp(page, "/settings")
    await page.getByRole("button", { name: "Sign in" }).click()
    const sheet = drawer(page)
    const email = sheet.getByLabel("Email")
    await expect(email, "the sheet focuses the first field").toBeFocused()
    const submit = sheet.getByRole("button", {
      name: "Sign in",
      exact: true,
    })

    await email.fill("ana@example.com")
    //Enter moves on to the password instead of submitting
    await email.press("Enter")
    const password = sheet.getByLabel("Password", { exact: true })
    await expect(password).toBeFocused()
    await password.fill("short")
    await expect(submit, "a password under 8 characters").toBeDisabled()
    await password.fill("long enough")
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(sheet.getByRole("alert")).toHaveText(
      "Sign-in is not available in this demo.",
    )
  })
})
