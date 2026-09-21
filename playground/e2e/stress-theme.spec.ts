import type { Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Theme under a race — the OS appearance flipping while the app switches its own
 * preference, twenty rounds, on both engines.
 *
 * `docs/design/behaviors.md §13` settles the contract: one module-level store
 * behind every `useTheme`, `setPreference` stamps `<html>` (class, `color-scheme`,
 * `data-ui-theme`) and `localStorage` in the same render, the OS listener acts
 * only in system mode, and a reload re-renders onto the pre-paint stamp with no
 * hydration error. So at every settled moment these all agree:
 *
 *   preference row  = the last preference set
 *   resolved row    = preference, or the emulated scheme under `system`
 *   html class      = resolved,  html color-scheme = resolved
 *   data-ui-theme   = preference, localStorage      = preference
 *
 * The race is the interleaving `settings.spec.ts` does once: an `emulateMedia`
 * flip is issued and, without waiting for it to land, a preference button is
 * pressed — twenty times, over every preference in turn. The invariants are
 * read once each round has settled; any round where two of the five disagree is
 * the failure this file exists for.
 */

const rowValue = (page: Page, label: string): Locator =>
  page
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::*[1]")

type Stamp = {
  cls: string | null
  colorScheme: string
  attr: string | null
  stored: string | null
}

const stamp = (page: Page) =>
  page.evaluate((): Stamp => {
    const root = document.documentElement
    return {
      cls: root.classList.contains("dark")
        ? "dark"
        : root.classList.contains("light")
          ? "light"
          : null,
      colorScheme: root.style.colorScheme,
      attr: root.getAttribute("data-ui-theme"),
      stored: localStorage.getItem("ui-theme-preference"),
    }
  })

type Preference = "light" | "dark" | "system"
type Scheme = "light" | "dark"

const PREFERENCES: Preference[] = ["light", "dark", "system"]

async function expectSettled(
  page: Page,
  preference: Preference,
  scheme: Scheme,
) {
  const resolved = preference === "system" ? scheme : preference
  await expect(rowValue(page, "preference")).toHaveText(preference)
  await expect(rowValue(page, "resolved")).toHaveText(resolved)
  await expect
    .poll(() => stamp(page), {
      message: `after ${preference} under an OS ${scheme} scheme`,
    })
    .toEqual({
      cls: resolved,
      colorScheme: resolved,
      attr: preference,
      stored: preference,
    })
}

test.describe("Theme under an OS race", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" })
    await page.goto("/lab/hooks")
    await awaitClientHandover(page)
    await expect(rowValue(page, "preference")).toHaveText("system")
    await expect(rowValue(page, "resolved")).toHaveText("light")
  })

  test("twenty rounds of OS flips racing the app's own switch never leave the stamps disagreeing", async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))

    for (let round = 0; round < 20; round += 1) {
      const scheme: Scheme = round % 2 === 0 ? "dark" : "light"
      const preference = PREFERENCES[round % 3]
      //the race: the OS flip is in flight when the button is pressed
      const flip = page.emulateMedia({ colorScheme: scheme })
      const press = page
        .getByRole("button", { name: preference, exact: true })
        .click()
      await Promise.all([flip, press])
      await expectSettled(page, preference, scheme)
    }
    expect(errors).toEqual([])
  })

  test("under system, the OS flipping twenty times moves resolved every time and touches nothing stored", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "system", exact: true }).click()
    await expectSettled(page, "system", "light")
    for (let flip = 0; flip < 20; flip += 1) {
      const scheme: Scheme = flip % 2 === 0 ? "dark" : "light"
      await page.emulateMedia({ colorScheme: scheme })
      await expectSettled(page, "system", scheme)
    }
  })

  test("under an explicit preference, the OS flipping is ignored, and a reload keeps the choice with no hydration error", async ({
    page,
  }) => {
    const consoleErrors: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })
    await page.getByRole("button", { name: "dark", exact: true }).click()
    await expectSettled(page, "dark", "light")
    for (let flip = 0; flip < 10; flip += 1) {
      await page.emulateMedia({
        colorScheme: flip % 2 === 0 ? "light" : "dark",
      })
      await expectSettled(page, "dark", flip % 2 === 0 ? "light" : "dark")
    }

    await page.emulateMedia({ colorScheme: "light" })
    await page.reload()
    //the pre-paint script has already stamped the choice before React runs
    expect(await stamp(page)).toEqual({
      cls: "dark",
      colorScheme: "dark",
      attr: "dark",
      stored: "dark",
    })
    await awaitClientHandover(page)
    await expectSettled(page, "dark", "light")
    expect(
      consoleErrors.filter((text) => /hydrat/i.test(text)),
      "no hydration mismatch",
    ).toEqual([])
  })
})
