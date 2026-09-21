import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import {
  card,
  createTask,
  drawer,
  expectDrawerGone,
  swipeOpen,
  taskCounts,
} from "./support/tasks-app"

/*
 * The tasks app under load — two hundred creates at once, a double-pressed
 * submit, a reload storm, and a delete that races the list's own animation, on
 * both engines.
 *
 * `app-tasks.spec.ts` drives the main flows one at a time. The contract here is
 * the store's: every create is one task with its own id and its own place in
 * the custom order, nothing is duplicated by a second press, nothing is lost
 * across reloads, and the page hydrates clean every time. The bulk creates go
 * through the app's own mutation module (the same one the create drawer calls),
 * reached by its dev-server URL, because two hundred drawers is a test of the
 * drawer, not of the store.
 *
 * The double press is a real double click: adaptv's press engine activates on
 * the pointer's release and swallows the browser's trailing `click`, so a DOM
 * `button.click()` reaches nothing and would pass the drawer-stays-open case
 * for the wrong reason. The reload storm counts errors only from the document
 * it settles on: WebKit reports the module imports a reload aborts in the
 * document it tore down as page errors, and those are the reload, not the app.
 */

const MUTATIONS = "/src/data/collections/todos/mutations.ts"
const STORE = "/src/data/store.ts"

test.use({ viewport: { width: 390, height: 844 } })

async function openApp(page: Page) {
  await page.goto("/")
  await awaitClientHandover(page)
  await expect(
    page.getByRole("heading", { level: 1, name: "Your tasks" }),
  ).toBeVisible()
}

type Row = { id: string; title: string; position: number }

/** Create N tasks at once through the app's mutation module. */
const createMany = (page: Page, prefix: string, count: number) =>
  page.evaluate(
    async ([url, prefix, count]) => {
      const mod = await import(/* @vite-ignore */ url)
      const created = await Promise.all(
        Array.from({ length: count }, (_, index) =>
          mod.createTodo({ title: `${prefix} ${index}` }),
        ),
      )
      return created.map((todo: Row) => ({
        id: todo.id,
        title: todo.title,
        position: todo.position,
      })) as Row[]
    },
    [MUTATIONS, prefix, count] as const,
  )

/** Every task the store holds, as the list's own order sees it. */
const storedRows = (page: Page) =>
  page.evaluate(async (url) => {
    const mod = await import(/* @vite-ignore */ url)
    const docs = (await mod.store.todos.query()) as {
      $id: string
      title: string
      position: number
    }[]
    return docs.map((doc) => ({
      id: doc.$id,
      title: doc.title,
      position: doc.position,
    })) as Row[]
  }, STORE)

function collectErrors(page: Page) {
  const errors: string[] = []
  page.on("pageerror", (error) =>
    errors.push(`uncaught: ${error.message}`),
  )
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console.error: ${message.text()}`)
    }
  })
  return errors
}

test.describe("The tasks app under load", () => {
  test("two hundred creates at once are two hundred tasks, each with its own place in the order", async ({
    page,
  }) => {
    await openApp(page)
    const errors = collectErrors(page)
    const created = await createMany(page, "Stress", 200)
    expect(created).toHaveLength(200)
    expect(new Set(created.map((row) => row.id)).size, "unique ids").toBe(
      200,
    )
    expect(new Set(created.map((row) => row.title)).size).toBe(200)

    const rows = await storedRows(page)
    expect(rows, "nothing lost, nothing duplicated").toHaveLength(200)
    const positions = rows.map((row) => row.position).sort((a, b) => a - b)
    expect(
      new Set(positions).size,
      `two tasks share a place in the custom order: ${JSON.stringify(
        positions.filter((p, i) => positions.indexOf(p) !== i).slice(0, 5),
      )}`,
    ).toBe(200)

    await expect(taskCounts(page)).toHaveText(/200 pending/)
    expect(errors).toEqual([])
  })

  test("five reloads in a row lose nothing and hydrate clean", async ({
    page,
  }) => {
    await openApp(page)
    await createMany(page, "Kept", 50)
    await expect(taskCounts(page)).toHaveText(/50 pending/)

    //five reloads back to back, each tearing down a document still booting
    for (let reload = 0; reload < 5; reload += 1) {
      await page.reload()
    }
    await awaitClientHandover(page)
    await expect(taskCounts(page)).toHaveText(/50 pending/)
    expect(await storedRows(page)).toHaveLength(50)

    //and the document that follows the storm boots clean, start to finish
    const errors = collectErrors(page)
    await page.reload()
    await awaitClientHandover(page)
    await expect(taskCounts(page)).toHaveText(/50 pending/)
    expect(await storedRows(page)).toHaveLength(50)
    expect(errors).toEqual([])
  })

  test("a double press on Add task saves one task", async ({ page }) => {
    await openApp(page)
    await page.getByRole("button", { name: "Create task" }).click()
    const sheet = drawer(page)
    await sheet.getByLabel("Task description").fill("Pressed twice")
    //two pointer presses inside the engine's double-click window: the first
    //release submits, and the second lands on whatever that left behind
    await sheet
      .getByRole("button", { name: "Add task", exact: true })
      .dblclick()
    await expectDrawerGone(page, "a saved task closes its drawer")
    await expect(card(page, "Pressed twice")).toHaveCount(1)
    await expect(taskCounts(page)).toHaveText(/1 pending/)
    expect(await storedRows(page)).toHaveLength(1)
  })

  test("an edit while fifty creates are in flight lands on the edited task, and only there", async ({
    page,
  }) => {
    await openApp(page)
    await createTask(page, { title: "Editable" })
    const inFlight = createMany(page, "Background", 50)
    await card(page, "Editable")
      .getByRole("button", { name: /^Editable/ })
      .click()
    const sheet = drawer(page)
    await expect(sheet.getByLabel("Task description")).toHaveValue(
      "Editable",
    )
    await sheet.getByLabel("Task description").fill("Edited under load")
    await sheet.getByRole("button", { name: "Save", exact: true }).click()
    await expectDrawerGone(page, "a saved edit closes its drawer")
    await inFlight

    const rows = await storedRows(page)
    expect(rows).toHaveLength(51)
    expect(
      rows.filter((row) => row.title === "Edited under load"),
    ).toHaveLength(1)
    expect(rows.filter((row) => row.title === "Editable")).toHaveLength(0)
    expect(new Set(rows.map((row) => row.position)).size).toBe(51)
    await expect(card(page, "Edited under load")).toBeVisible()
    await expect(taskCounts(page)).toHaveText(/51 pending/)
  })

  test("a create through the drawer while fifty creates are in flight is one more task", async ({
    page,
  }) => {
    await openApp(page)
    const inFlight = createMany(page, "Background", 50)
    await createTask(page, { title: "Foreground" })
    await inFlight
    const rows = await storedRows(page)
    expect(rows).toHaveLength(51)
    expect(new Set(rows.map((row) => row.position)).size).toBe(51)
    await expect(taskCounts(page)).toHaveText(/51 pending/)
  })

  test("a delete during the list's own animation is a delete, and a reload agrees", async ({
    page,
  }) => {
    await openApp(page)
    await createTask(page, { title: "Doomed" })
    await createTask(page, { title: "Survivor" })
    await expect(taskCounts(page)).toHaveText(/2 pending/)

    const button = await swipeOpen(page, "Doomed", "Delete")
    await button.click()
    //reload while the row is still leaving: the store, not the animation,
    //decides what survives
    await page.reload()
    await awaitClientHandover(page)
    await expect(card(page, "Doomed")).toHaveCount(0)
    await expect(card(page, "Survivor")).toBeVisible()
    await expect(taskCounts(page)).toHaveText(/1 pending/)
    expect((await storedRows(page)).map((row) => row.title)).toEqual([
      "Survivor",
    ])
  })
})
