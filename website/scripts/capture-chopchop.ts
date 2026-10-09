/*
 * Renders the landing page's ChopChop screens: the hero's two phones.
 *
 *   node website/scripts/capture-chopchop.ts http://localhost:7171
 *
 * The URL serves ChopChop's frontend built for the web (its repo's `apps/frontend`:
 * `vite build`, then `vite preview` with the committed env/.env.example). No backend
 * and no account: every screen is a guest's first open, filled through the UI with the
 * demo tasks below, so no real data, email or hostname reaches a capture. What these
 * captures are and aren't: phones.ts.
 */
import { join } from "node:path"
import { capture, type Page, type Phone, root } from "./phones.ts"

const url = process.argv[2]
if (!url) {
  process.stderr.write(
    "usage: node website/scripts/capture-chopchop.ts <url>\n",
  )
  process.exit(1)
}

const TASKS = [
  ["Water the plants", null, true],
  ["Buy oat milk", "Medium", false],
  ["Call the dentist", "High", true],
  ["Book train to Porto", "Low", false],
  ["Return the library books", null, false],
  ["Plan Saturday's run", "Urgent", false],
] as const

async function addTasks(page: Page, tasks: readonly (typeof TASKS)[number][]) {
  await page.getByRole("button", { name: "Create task" }).waitFor()
  for (const [title, priority, dueToday] of tasks) {
    await page.getByRole("button", { name: "Create task" }).click()
    const drawer = page.getByRole("dialog")
    await drawer.getByLabel("Task description").fill(title)
    if (priority) await drawer.getByRole("button", { name: priority }).click()
    if (dueToday)
      await drawer.getByRole("button", { name: "Add due date" }).click()
    await drawer.getByRole("button", { name: "Add task" }).click()
    await drawer.waitFor({ state: "hidden" })
  }
}

/*
 * ChopChop's installed-app styles sit behind `display-mode: standalone`, which Chromium
 * can't emulate, and read the insets from env(), which it leaves at 0. Each stylesheet is
 * re-added with the installed branch always on and env() read from the variables
 * phones.ts stamps, so the app lays out as on the home screen under the drawn status bar.
 */
async function installed(page: Page) {
  await page.evaluate(async () => {
    for (const sheet of [...document.styleSheets]) {
      const owner = sheet.ownerNode
      if (
        !(owner instanceof HTMLLinkElement || owner instanceof HTMLStyleElement)
      )
        continue
      const css =
        owner instanceof HTMLLinkElement
          ? await (await fetch(owner.href)).text()
          : (owner.textContent ?? "")
      const style = document.createElement("style")
      style.textContent = css
        .replaceAll("(display-mode: standalone)", "all")
        .replaceAll("(display-mode:standalone)", "all")
        .replaceAll("(display-mode: browser)", "not all")
        .replaceAll("(display-mode:browser)", "not all")
        .replaceAll("env(safe-area-inset-", "var(--safe-area-inset-")
      owner.after(style)
      sheet.disabled = true
    }
    //phones.ts stamps top and bottom; an unset variable would void a padding with no fallback
    document.documentElement.style.setProperty("--safe-area-inset-left", "0px")
    document.documentElement.style.setProperty("--safe-area-inset-right", "0px")
  })
}

//settle: the drawers and the list animate in
const settle = (page: Page) => page.waitForTimeout(1000)

const SCREENS: Record<string, [Phone, (page: Page) => Promise<void>]> = {
  "hero/chopchop-ios": [
    "ios",
    async (page) => {
      await addTasks(page, TASKS)
      await installed(page)
      await settle(page)
    },
  ],
  "hero/chopchop-android": [
    "android",
    async (page) => {
      await addTasks(page, TASKS.slice(0, 4))
      await installed(page)
      await page.getByRole("button", { name: "Create task" }).click()
      await page
        .getByRole("dialog")
        .getByLabel("Task description")
        .fill("Pick up the bike from the shop")
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "High" })
        .click()
      //a blinking caret is either in the shot or not; keep it out
      await page.addStyleTag({ content: "* { caret-color: transparent }" })
      await settle(page)
    },
  ],
}

for (const [name, [phone, setup]] of Object.entries(SCREENS)) {
  await capture(
    phone,
    url,
    join(root, `website/src/assets/${name}.webp`),
    setup,
    2,
  )
}
