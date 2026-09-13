import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import {
  card,
  cardTitles,
  chooseSort,
  createTask,
  dragCardOnto,
  drawer,
  expectDrawerGone,
  nextYearLabel,
  swipeOpen,
  TUTORIAL_DECK,
  taskCounts,
} from "./support/tasks-app"

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

test.describe("the tasks app", () => {
  test("a fresh profile lands on the seeded Tutorial deck with no tasks", async ({
    page,
  }) => {
    await openApp(page)
    await expect(
      page.getByRole("heading", { level: 1, name: "Your tasks" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: TUTORIAL_DECK, exact: true }),
    ).toBeVisible()
    await expect(taskCounts(page)).toHaveText(/0 pending\s*•\s*0 archived/)
    await expect(
      page.getByText("Tap + Create to create your first task."),
    ).toBeVisible()
  })

  test("a task created with a priority and a due date shows both, and survives a reload", async ({
    page,
  }) => {
    await openApp(page)
    await createTask(page, {
      title: "Renew passport",
      priority: "High",
      dueNextYear: true,
    })
    const created = card(page, "Renew passport")
    await expect(created).toContainText("High")
    await expect(created).toContainText(nextYearLabel())
    await expect(taskCounts(page)).toHaveText(/1 pending/)

    await reloadApp(page)
    await expect(card(page, "Renew passport")).toContainText("High")
    await expect(card(page, "Renew passport")).toContainText(
      nextYearLabel(),
    )
    await expect(taskCounts(page)).toHaveText(/1 pending/)
  })

  test("editing a task rewrites its title, clears its priority and due date, and persists", async ({
    page,
  }) => {
    await openApp(page)
    await createTask(page, {
      title: "Call the bank",
      priority: "Urgent",
      dueNextYear: true,
    })

    await card(page, "Call the bank")
      .getByRole("button", { name: /^Call the bank/ })
      .click()
    const sheet = drawer(page)
    const field = sheet.getByLabel("Task description")
    await expect(field, "the form opens on the task").toHaveValue(
      "Call the bank",
    )
    await expect(
      sheet.getByRole("button", { name: "Urgent", exact: true }),
    ).toHaveAttribute("aria-pressed", "true")
    await field.fill("Call the bank about the card")
    await sheet.getByRole("button", { name: "None", exact: true }).click()
    await sheet.getByRole("button", { name: "Clear due date" }).click()
    await sheet.getByRole("button", { name: "Save", exact: true }).click()
    await expectDrawerGone(page, "a saved edit closes its drawer")

    const edited = card(page, "Call the bank about the card")
    await expect(edited).toBeVisible()
    await expect(edited).not.toContainText("Urgent")
    await expect(edited).not.toContainText("Due")
    await expect(card(page, "Call the bank")).toHaveCount(0)

    await reloadApp(page)
    await expect(card(page, "Call the bank about the card")).toBeVisible()
    await expect(
      card(page, "Call the bank about the card"),
    ).not.toContainText("Urgent")
  })

  test("completing a task pins it under Completed, and unchecking brings it back", async ({
    page,
  }) => {
    await openApp(page)
    await createTask(page, { title: "Water the plants" })
    await createTask(page, { title: "Book a dentist" })
    await expect(taskCounts(page)).toHaveText(/2 pending/)

    const box = card(page, "Water the plants").getByRole("checkbox")
    await box.focus()
    await page.keyboard.press("Space")
    await expect(box).toBeChecked()
    await expect(taskCounts(page)).toHaveText(/1 pending/)
    await expect(
      page.getByRole("heading", { name: "Completed" }),
    ).toBeVisible()
    await expect
      .poll(() => cardTitles(page))
      .toEqual(["Book a dentist", "Water the plants"])

    await reloadApp(page)
    const reloaded = card(page, "Water the plants").getByRole("checkbox")
    await expect(reloaded, "the check is stored").toBeChecked()
    await expect(taskCounts(page)).toHaveText(/1 pending/)

    await reloaded.focus()
    await page.keyboard.press("Space")
    await expect(reloaded).not.toBeChecked()
    await expect(taskCounts(page)).toHaveText(/2 pending/)
    await expect(
      page.getByRole("heading", { name: "Completed" }),
    ).toHaveCount(0)
  })

  test("swiping a task to archive moves it to the archive, and unarchive brings it back", async ({
    page,
  }) => {
    await openApp(page)
    await createTask(page, { title: "File the taxes" })

    await (await swipeOpen(page, "File the taxes", "Archive")).click()
    await expect(card(page, "File the taxes")).toHaveCount(0)
    await expect(taskCounts(page)).toHaveText(/0 pending\s*•\s*1 archived/)

    await taskCounts(page)
      .getByRole("button", { name: "1 archived" })
      .click()
    await expect(
      page.getByText("You are seeing your archived tasks"),
    ).toBeVisible()
    await expect(
      card(page, "File the taxes").getByRole("checkbox", {
        name: "Archived task",
      }),
    ).toBeChecked()

    //the view itself is a stored preference: a reload reopens the archive
    await reloadApp(page)
    await expect(
      page.getByText("You are seeing your archived tasks"),
    ).toBeVisible()

    await (await swipeOpen(page, "File the taxes", "Unarchive")).click()
    await expect(card(page, "File the taxes")).toHaveCount(0)
    await page.getByRole("button", { name: "go back" }).click()
    await expect(
      card(page, "File the taxes").getByRole("checkbox", {
        name: "Mark complete",
      }),
    ).not.toBeChecked()
    await expect(taskCounts(page)).toHaveText(/1 pending\s*•\s*0 archived/)
  })

  test("swiping a task to delete removes it for good", async ({
    page,
  }) => {
    await openApp(page)
    await createTask(page, { title: "Cancel the gym" })
    await createTask(page, { title: "Buy stamps" })

    await (await swipeOpen(page, "Cancel the gym", "Delete")).click()
    await expect(card(page, "Cancel the gym")).toHaveCount(0)
    await expect(taskCounts(page)).toHaveText(/1 pending\s*•\s*0 archived/)

    await reloadApp(page)
    await expect(card(page, "Buy stamps")).toBeVisible()
    await expect(card(page, "Cancel the gym")).toHaveCount(0)
    await expect(taskCounts(page)).toHaveText(/1 pending\s*•\s*0 archived/)
  })

  test("each sort orders the same tasks its own way, and the choice survives a reload", async ({
    page,
  }) => {
    await openApp(page)
    //created oldest to newest: rent, trip, book
    await createTask(page, { title: "Pay rent", priority: "Urgent" })
    await createTask(page, {
      title: "Plan the trip",
      priority: "Low",
      dueNextYear: true,
    })
    await createTask(page, { title: "Read a book" })

    await expect
      .poll(() => cardTitles(page), {
        message: "Date added: newest first",
      })
      .toEqual(["Read a book", "Plan the trip", "Pay rent"])
    await expect(
      page.getByRole("heading", { name: "Added today" }),
    ).toBeVisible()

    await chooseSort(page, "Priority")
    await expect
      .poll(() => cardTitles(page), {
        message: "Priority: most urgent first, no priority last",
      })
      .toEqual(["Pay rent", "Plan the trip", "Read a book"])
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Urgent",
      "Low",
      "No priority",
    ])

    await chooseSort(page, "Due date")
    await expect
      .poll(() => cardTitles(page), {
        message: "Due date: dated first, then undated by priority",
      })
      .toEqual(["Plan the trip", "Pay rent", "Read a book"])
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      nextYearLabel(),
      "No due date",
    ])

    await reloadApp(page)
    await expect
      .poll(() => cardTitles(page), { message: "the sort is stored" })
      .toEqual(["Plan the trip", "Pay rent", "Read a book"])
    await page.getByRole("button", { name: "Sort tasks" }).click()
    await expect(
      drawer(page).getByRole("radio", { name: /^Due date/ }),
    ).toHaveAttribute("aria-checked", "true")
  })

  test("in the custom sort a task moved by mouse or by keyboard keeps its place across a reload", async ({
    page,
  }) => {
    await openApp(page)
    for (const title of ["First", "Second", "Third"]) {
      await createTask(page, { title })
    }
    await chooseSort(page, "Custom")
    await expect(
      page.getByRole("heading", { name: "Custom" }),
    ).toBeVisible()
    await expect
      .poll(() => cardTitles(page), {
        message: "custom starts in creation order",
      })
      .toEqual(["First", "Second", "Third"])

    await dragCardOnto(page, "Third", "First")
    await expect
      .poll(() => cardTitles(page), {
        message: "the drop reorders the list",
      })
      .toEqual(["Third", "First", "Second"])

    //the keyboard path: focus the row itself, Space to pick up, an arrow to
    //move, Space to drop
    await page
      .getByRole("listitem")
      .filter({ has: card(page, "Second") })
      .focus()
    //each step waits on what a screen reader hears: the sensor arms its key
    //listeners a tick after the pick-up, so an arrow sent sooner is dropped.
    //The announcement names the carried row and the row it is over.
    const over = async () => {
      const region = page.getByText(/was moved over droppable area/)
      if ((await region.count()) === 0) return "not dragging"
      const text = (await region.textContent()) ?? ""
      const [, item, area] =
        text.match(/item (\S+) was moved over droppable area (\S+)\./) ??
        []
      return item === area ? "over itself" : "over another row"
    }
    await page.keyboard.press("Space")
    await expect
      .poll(over, { message: "Space picks the row up" })
      .toBe("over itself")
    await page.keyboard.press("ArrowUp")
    await expect
      .poll(over, { message: "ArrowUp carries it over the row above" })
      .toBe("over another row")
    await page.keyboard.press("Space")
    await expect
      .poll(() => cardTitles(page), {
        message: "a keyboard move reorders the list",
      })
      .toEqual(["Third", "Second", "First"])

    await reloadApp(page)
    await expect
      .poll(() => cardTitles(page), { message: "the new order is stored" })
      .toEqual(["Third", "Second", "First"])

    //a checked task pins below the pending run and can no longer be dragged, but
    //its checkbox must stay operable, to a screen reader too
    const third = card(page, "Third").getByRole("checkbox")
    await third.focus()
    await page.keyboard.press("Space")
    await expect(third).toBeChecked()
    //Space belongs to the checkbox — it must not also lift the card into a
    //keyboard drag (a second copy of the card floats over the list)
    await expect(
      page.getByText(/picked up draggable item|over droppable area/i),
      "a key press on a card's checkbox must not start dragging the card",
    ).toHaveCount(0)
    await expect
      .poll(() => cardTitles(page), {
        message: "the checked task pins last",
      })
      .toEqual(["Second", "First", "Third"])
    await expect(
      card(page, "Third").getByRole("checkbox", {
        name: "Mark incomplete",
      }),
      "a row that cannot be dragged must not expose its checkbox as disabled",
    ).toBeEnabled()
  })
})
