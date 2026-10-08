/*
 * Renders the stand-in screenshots of the playground app for the landing page's examples.
 *
 *   node website/scripts/capture-examples.ts http://localhost:4391
 *
 * The URL serves the playground built for the web: `pnpm build`, `pnpm build` in
 * playground/apps/frontend, then any static server on `.output/public` that answers an
 * unknown path with adaptv-shell.html. Every screen starts from an empty app and gets to
 * its state through the UI, as a visitor would. What a stand-in is and isn't: phones.ts.
 */
import { join } from "node:path"
import { capture, type Page, type Phone, root } from "./phones.ts"

const url = process.argv[2]
if (!url) {
  process.stderr.write(
    "usage: node website/scripts/capture-examples.ts <url>\n",
  )
  process.exit(1)
}

/*
 * Shown at most 280 px wide, so 1.5x is sharp on a 2x screen at a quarter of the phone's
 * pixels. WebP, not PNG: the row loads before the visitor scrolls to it, and three PNGs
 * cost the hero's largest paint about 6 Lighthouse points.
 */
const SCALE = 1.5

const TASKS = [
  ["Water the plants", null],
  ["Buy oat milk", "Medium"],
  ["Call the dentist", "High"],
  ["Book train to Porto", "Low"],
  ["Return the library books", null],
] as const

async function fill(page: Page, title: string, priority: string | null) {
  await page.getByLabel("Task description").fill(title)
  if (priority) await page.getByText(priority, { exact: true }).click()
}

async function addTasks(page: Page, tasks: readonly (typeof TASKS)[number][]) {
  for (const [title, priority] of tasks) {
    await page.getByLabel("Create task").click()
    await fill(page, title, priority)
    await page.getByRole("button", { name: "Add task" }).click()
    await page.getByLabel("Create task").waitFor()
    await page.waitForTimeout(500)
  }
}

//settle: the drawers and the list animate in
const settle = (page: Page) => page.waitForTimeout(1000)

const SCREENS: Record<string, [Phone, (page: Page) => Promise<void>]> = {
  tasks: [
    "ios",
    async (page) => {
      await addTasks(page, TASKS)
      await settle(page)
    },
  ],
  "new-task": [
    "android",
    async (page) => {
      await addTasks(page, TASKS.slice(0, 3))
      await page.getByLabel("Create task").click()
      //Low: picking a later chip scrolls the row and cuts off None
      await fill(page, "Book train to Porto", "Low")
      //a blinking caret is either in the shot or not; keep it out
      await page.addStyleTag({ content: "* { caret-color: transparent }" })
      await settle(page)
    },
  ],
  sort: [
    "ios",
    async (page) => {
      await addTasks(page, TASKS)
      await page.getByLabel("Sort tasks").click()
      await settle(page)
    },
  ],
}

for (const [name, [phone, setup]] of Object.entries(SCREENS)) {
  await capture(
    phone,
    url,
    join(root, `website/src/assets/examples/${name}.webp`),
    setup,
    SCALE,
  )
}
