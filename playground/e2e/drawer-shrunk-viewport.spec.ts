import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The drawer's keyboard room is `keyboard - shrink`: the part of the keyboard the layout
 * viewport has NOT already given up. The engine measures that shrink rather than guessing it
 * from the platform, because the Android WebView under Capacitor 8 gives up the whole keyboard
 * (`innerHeight` 923 → 587 for a 336px keyboard) while every signal that used to mean "the
 * viewport is frozen" reads true. This spec plays both halves on chromium: the keyboard seam
 * reports the keyboard, and the viewport either keeps its height (room held) or shrinks by the
 * keyboard (no room, the box caps at what is visible).
 *
 * The seam has to be installed before the hook mounts (addInitScript), and the shrink is a real
 * `setViewportSize`, which is the only thing that moves `innerHeight` in a Playwright page.
 */

const KEYBOARD_EVENT = "adaptv:keyboard-mock"
const PANEL = "[data-pwa-drawer]"
const KEYBOARD = 300

async function setKeyboard(page: Page, isOpen: boolean, height: number) {
  await page.evaluate(
    ({ o, h, evt }) => {
      ;(
        window as unknown as { __adaptvKeyboardMock?: unknown }
      ).__adaptvKeyboardMock = { isOpen: o, height: h }
      window.dispatchEvent(new Event(evt))
    },
    { o: isOpen, h: height, evt: KEYBOARD_EVENT },
  )
}

function readBox(page: Page) {
  return page.evaluate((panelSel) => {
    const panel = document.querySelector<HTMLElement>(panelSel)
    const content = panel?.firstElementChild as HTMLElement | null
    if (!content) return null
    const rect = content.getBoundingClientRect()
    return {
      room: content.style.paddingBottom,
      maxHeight: content.style.maxHeight,
      bottom: Math.round(rect.bottom),
      innerHeight: window.innerHeight,
    }
  }, PANEL)
}

test.describe("the drawer's keyboard room against a shrinking layout viewport", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      ;(
        window as unknown as { __adaptvKeyboardMock?: unknown }
      ).__adaptvKeyboardMock = { isOpen: false, height: 0 }
    })
    await page.goto("/lab/drawer")
    await awaitClientHandover(page)
    await page
      .getByRole("button", { name: "Open keyboard drawer", exact: true })
      .first()
      .click()
    await page.locator(PANEL).waitFor({ state: "attached" })
    await expect(page.locator(PANEL)).toHaveAttribute("data-open", "true")
  })

  test("holds the whole keyboard as room while the viewport keeps its height", async ({
    page,
  }) => {
    await setKeyboard(page, true, KEYBOARD)
    await expect
      .poll(async () => (await readBox(page))?.room)
      .toBe(`${KEYBOARD}px`)

    await setKeyboard(page, false, 0)
    await expect.poll(async () => (await readBox(page))?.room).toBe("0px")
  })

  test("holds no room once the viewport has shrunk by the keyboard, and caps at what is visible", async ({
    page,
  }) => {
    const size = page.viewportSize()
    if (!size) throw new Error("no viewport")

    await setKeyboard(page, true, KEYBOARD)
    await page.setViewportSize({
      width: size.width,
      height: size.height - KEYBOARD,
    })

    await expect
      .poll(async () => {
        const box = await readBox(page)
        return (
          box && { room: box.room, fits: box.bottom <= box.innerHeight }
        )
      })
      .toEqual({ room: "0px", fits: true })
    const shrunk = await readBox(page)
    expect(shrunk?.innerHeight).toBe(size.height - KEYBOARD)
    expect(
      Number.parseFloat(shrunk?.maxHeight ?? "NaN"),
    ).toBeLessThanOrEqual(size.height - KEYBOARD)

    //the keyboard goes and the viewport comes back: the cap is released, nothing is left behind
    await setKeyboard(page, false, 0)
    await page.setViewportSize(size)
    await expect
      .poll(async () => {
        const box = await readBox(page)
        return box && { room: box.room, maxHeight: box.maxHeight }
      })
      .toEqual({ room: "", maxHeight: "" })
  })
})
