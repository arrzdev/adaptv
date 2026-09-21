import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Settings — the Light / Dark / System theme control.
 *
 * The OS appearance is `page.emulateMedia({ colorScheme })`, which both engines
 * deliver to `matchMedia` as a live change event: the same signal a phone sends
 * when the user flips dark mode from Control Center. What is asserted is what
 * the app paints (the class on <html>) and what the control shows (aria-pressed),
 * never the hook's internals.
 *
 * A "stays dark" check is only worth something once the page has RECEIVED the
 * change: `emulateMedia` resolves before the event is dispatched, so a class read
 * straight after it passes against a listener that would have repainted a moment
 * later. `setScheme` waits for a probe listener on the same query to count the
 * event first; every listener on it fires in that one dispatch.
 *
 * The reload step is the hydration claim. The server cannot read the stored
 * preference, so it renders "system"; the pre-paint script has already stamped
 * the stored "dark" by the time React hydrates. A first client render that read
 * the stamp would not match the server HTML, and React says so on the console.
 */

test.use({ viewport: { width: 390, height: 844 } })

const STORAGE_KEY = "ui-theme-preference"

function themeButton(page: Page, name: "Light" | "Dark" | "System") {
  return page
    .getByRole("group", { name: "Theme" })
    .getByRole("button", { name, exact: true })
}

async function expectPainted(page: Page, appearance: "light" | "dark") {
  await expect(page.locator("html")).toHaveClass(
    new RegExp(`(^|\\s)${appearance}(\\s|$)`),
  )
}

/** The class on <html> right now, once `setScheme` proved the event landed. */
async function expectStillPainted(
  page: Page,
  appearance: "light" | "dark",
) {
  const classes = await page.evaluate(() => [
    ...document.documentElement.classList,
  ])
  expect(classes).toContain(appearance)
}

async function setScheme(page: Page, colorScheme: "light" | "dark") {
  const count = () =>
    page.evaluate(
      () =>
        (window as unknown as { __schemeChanges: number }).__schemeChanges,
    )
  const before = await count()
  await page.emulateMedia({ colorScheme })
  await expect.poll(count).toBe(before + 1)
}

async function expectSelected(
  page: Page,
  name: "Light" | "Dark" | "System",
) {
  for (const option of ["Light", "Dark", "System"] as const) {
    await expect(themeButton(page, option)).toHaveAttribute(
      "aria-pressed",
      String(option === name),
    )
  }
}

/** The option the server-rendered HTML marks as pressed, or null if none is. */
async function serverSelected(page: Page) {
  const html = await (await page.request.get("/settings")).text()
  const start = html.indexOf('aria-label="Theme"')
  expect(
    start,
    "the theme control is not server-rendered",
  ).toBeGreaterThan(-1)
  const buttons = html.slice(start).split("<button").slice(1, 4)
  const pressed = buttons.find((b) => b.includes('aria-pressed="true"'))
  return pressed?.match(/>(Light|Dark|System)</)?.[1] ?? null
}

test.describe("Settings theme", () => {
  test("offers Light / Dark / System, follows the OS only on System, and survives a reload", async ({
    page,
  }) => {
    //any hydration complaint from React, on any load of this test
    const hydration: string[] = []
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) hydration.push(message.text())
    })
    page.on("pageerror", (error) => {
      if (/hydrat|#418|#423|#425/i.test(error.message)) {
        hydration.push(error.message)
      }
    })

    await page.emulateMedia({ colorScheme: "light" })
    await page.addInitScript(() => {
      const probe = window as unknown as { __schemeChanges: number }
      probe.__schemeChanges = 0
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", () => {
          probe.__schemeChanges += 1
        })
    })
    await page.goto("/settings")
    await awaitClientHandover(page)
    await themeButton(page, "Light").scrollIntoViewIfNeeded()

    await test.step("an explicit Light ignores the OS", async () => {
      await themeButton(page, "Light").click()
      await expectSelected(page, "Light")
      await setScheme(page, "dark")
      await expectStillPainted(page, "light")
      await expectSelected(page, "Light")
    })

    await test.step("System under a dark OS paints dark", async () => {
      await themeButton(page, "System").click()
      await expectSelected(page, "System")
      await expectPainted(page, "dark")
    })

    await test.step("System follows the OS to light, live", async () => {
      await setScheme(page, "light")
      await expectPainted(page, "light")
      await expectSelected(page, "System")
    })

    await test.step("Dark stays dark whatever the OS does", async () => {
      await themeButton(page, "Dark").click()
      await expectSelected(page, "Dark")
      await expectPainted(page, "dark")
      for (const colorScheme of ["dark", "light"] as const) {
        await setScheme(page, colorScheme)
        await expectStillPainted(page, "dark")
      }
      await expectSelected(page, "Dark")
      expect(
        await page.evaluate(
          (key) => localStorage.getItem(key),
          STORAGE_KEY,
        ),
      ).toBe("dark")
    })

    await test.step("a reload keeps Dark, with no hydration error", async () => {
      //the premise: the control is server-rendered, and the server can only
      //render the default, so this reload really is a hydration over "System"
      expect(await serverSelected(page)).toBe("System")
      await page.reload()
      await awaitClientHandover(page)
      await expectPainted(page, "dark")
      await expectSelected(page, "Dark")
      expect(hydration).toEqual([])
    })
  })
})
