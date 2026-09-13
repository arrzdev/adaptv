import type { Locator, Page } from "@playwright/test"
import { expect } from "@playwright/test"

/*
 * Drivers for the playground's own app — the tasks list at `/` and `/settings` —
 * shared by `app-tasks.spec.ts` and `app-settings.spec.ts`.
 *
 * Loading a route stays in each spec, next to its hydration gate
 * (`awaitClientHandover`), so no spec can drive the app before React does.
 *
 * Every Playwright test gets a fresh browser context, which is a fresh profile:
 * an empty IndexedDB (the local store) and an empty localStorage (the view
 * preferences). So every test starts from the first-run seed — the Tutorial deck
 * and no tasks — and nothing a test writes can leak into another.
 *
 * The instruments, and why each one:
 *   - Buttons, the pickers' chips and the wheel's rows are driven with a plain
 *     `click()`. adaptv's press engine activates on it in both engines.
 *   - A checkbox or a switch is driven by keyboard (focus + Space). Their pointer
 *     gesture engine does not answer synthetic pointer input headless (see
 *     toggles.spec.ts), while the keyboard path is a real user path.
 *   - The swipe actions are driven with a MOUSE drag. Swipeable handles a mouse
 *     pointer itself (touch goes through its own listeners), so the same drag
 *     opens a row on chromium and on the mobile WebKit profile, where CDP touch
 *     does not exist.
 *   - The hold-to-confirm buttons are held from the keyboard: the gesture engine
 *     starts its long-press timer on a Space keydown, so holding the key for the
 *     real duration is the whole gesture, with no pointer quirks.
 *   - The date wheel is driven by tapping a neighbouring row, which rolls it to
 *     the centre and commits. `mouse.wheel` throws on the mobile WebKit profile.
 */

export const TUTORIAL_DECK = "🪜 Tutorial"

/** The subtitle under the tasks heading: "N pending • M archived". */
export function taskCounts(page: Page) {
  return page.locator("p", { hasText: /\d+ pending/ }).first()
}

/** One task card, found by its title. */
export function card(page: Page, title: string) {
  return page.locator("[data-swipeable-root]", {
    has: page.getByText(title, { exact: true }),
  })
}

/** The titles of every task card on screen, top to bottom. */
export async function cardTitles(page: Page) {
  return page
    .locator("[data-swipeable-content] p:first-child")
    .allInnerTexts()
}

/** The one open drawer. */
export function drawer(page: Page) {
  return page.getByRole("dialog")
}

/*
 * Wait for a drawer to be truly gone. The dialog leaves the accessibility tree
 * when it starts closing, but its full-screen overlay stays mounted until the
 * exit animation ends, and it takes every pointer until then — a swipe begun in
 * that window lands on the overlay. A user's finger can't reach the list either,
 * so "the overlay is unmounted" is the honest oracle for "the page is back".
 */
export async function expectDrawerGone(page: Page, message: string) {
  await expect(drawer(page), message).toBeHidden()
  await expect(
    page.locator("[data-pwa-drawer-overlay]"),
    "the closing drawer's overlay must unmount",
  ).toHaveCount(0)
}

/** Press a toggle chip (priority, deck, emoji) and prove it took. */
export async function pressChip(sheet: Locator, name: string) {
  const chip = sheet.getByRole("button", { name, exact: true })
  await chip.click()
  await expect(chip, `the "${name}" chip must select`).toHaveAttribute(
    "aria-pressed",
    "true",
  )
}

export type NewTask = {
  title: string
  priority?: "Low" | "Medium" | "High" | "Urgent"
  deck?: string
  /** Roll the Year wheel one row down: the due date becomes today, next year. */
  dueNextYear?: boolean
}

/** Local "today, next year" as the card prints it — Feb 29 clamps to Feb 28. */
export function nextYearLabel() {
  const now = new Date()
  const year = now.getFullYear() + 1
  const month = now.getMonth()
  const lastDay = new Date(year, month + 1, 0).getDate()
  const day = Math.min(now.getDate(), lastDay)
  const dd = String(day).padStart(2, "0")
  const mm = String(month + 1).padStart(2, "0")
  return `Due ${dd}/${mm}/${year}`
}

/** Pick a due date one year out through the wheel, from inside an open form. */
export async function pickDueNextYear(sheet: Locator) {
  const nextYear = String(new Date().getFullYear() + 1)
  await sheet.getByRole("button", { name: "Add due date" }).click()
  const yearWheel = sheet.getByLabel("Year", { exact: true })
  await yearWheel
    .getByRole("button", { name: nextYear, exact: true })
    .click()
  await expect(
    yearWheel.locator('button[data-active="true"]'),
    "tapping the next year's row must roll it to the centre",
  ).toHaveText(nextYear)
}

/** Create a task through the create drawer, the way a user does. */
export async function createTask(page: Page, task: NewTask) {
  await page.getByRole("button", { name: "Create task" }).click()
  const sheet = drawer(page)
  await sheet.getByLabel("Task description").fill(task.title)
  if (task.deck) await pressChip(sheet, task.deck)
  if (task.priority) await pressChip(sheet, task.priority)
  if (task.dueNextYear) await pickDueNextYear(sheet)
  await sheet
    .getByRole("button", { name: "Add task", exact: true })
    .click()
  await expectDrawerGone(page, "a saved task closes its drawer")
  await expect(card(page, task.title)).toBeVisible()
}

/*
 * Drag a card's content sideways with the mouse until its right-hand actions are
 * uncovered. Released after a pause so position, not a flick, decides that it
 * opens; the reveal is then asserted on the action itself — it must be the element
 * a tap at its centre lands on, which is the premise the next click relies on.
 */
export async function swipeOpen(
  page: Page,
  title: string,
  action: string,
) {
  const content = card(page, title).locator("[data-swipeable-content]")
  await content.scrollIntoViewIfNeeded()
  const box = await content.boundingBox()
  if (!box) throw new Error(`the card "${title}" has no layout box`)
  const y = box.y + box.height / 2
  const x = box.x + box.width * 0.75
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 200, y, { steps: 12 })
  await page.mouse.up()
  const button = page.getByRole("button", {
    name: `${action} ${title}`,
    exact: true,
  })
  await expect
    .poll(
      () =>
        button.evaluate((el) => {
          const r = el.getBoundingClientRect()
          const hit = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          )
          return !!hit && el.contains(hit)
        }),
      { message: `the swipe must uncover "${action} ${title}"` },
    )
    .toBe(true)
  return button
}

/** Choose a sort from the sort drawer. */
export async function chooseSort(page: Page, title: string) {
  await page.getByRole("button", { name: "Sort tasks" }).click()
  const sheet = drawer(page)
  await sheet.getByRole("radio", { name: new RegExp(`^${title}`) }).click()
  await expectDrawerGone(page, "choosing a sort closes the drawer")
}

/*
 * Reorder with the mouse: press a card, move past dnd-kit's 8px activation
 * distance, carry it over the target card and drop. The press lands left of
 * centre, on the card's own body, which is where a user grabs it.
 */
export async function dragCardOnto(
  page: Page,
  title: string,
  onto: string,
) {
  const from = await card(page, title).boundingBox()
  const to = await card(page, onto).boundingBox()
  if (!from || !to) throw new Error("a card to reorder has no layout box")
  const x = from.x + 40
  const y = from.y + from.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + (to.y < from.y ? -10 : 10), { steps: 3 })
  await page.mouse.move(x, to.y + (to.y < from.y ? 5 : to.height - 5), {
    steps: 15,
  })
  await page.mouse.up()
}

/** Hold a hold-to-confirm button from the keyboard until it confirms. */
export async function holdToConfirm(button: Locator, sheet: Locator) {
  await button.focus()
  await button.page().keyboard.down(" ")
  //the hold IS the gesture: the drawer closes when the confirm lands, and the
  //bound is the hold plus the write, not a guess
  await expect(sheet, "a confirmed hold closes its drawer").toBeHidden({
    timeout: 15_000,
  })
  await button.page().keyboard.up(" ")
  await expectDrawerGone(
    button.page(),
    "a confirmed hold closes its drawer",
  )
}
