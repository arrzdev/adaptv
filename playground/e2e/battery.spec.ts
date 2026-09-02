import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * The battery capability on the two engines the suite runs. Chromium has
 * `navigator.getBattery`; the harness replaces it before the document with a
 * manager it controls, so the page's numbers and its reaction to `levelchange`
 * are the assertion, not whatever the CI machine's battery happens to read.
 * WebKit never shipped the API, so there the page must say unsupported rather
 * than guess — that row runs against the real engine, unstubbed.
 */

declare global {
  interface Window {
    __battery?: {
      level: number
      charging: boolean
      fire: (t: string) => void
    }
  }
}

async function awaitClientHandover(page: Page) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
}

test.describe("Battery where the engine has no API", () => {
  test("reads unsupported on WebKit", async ({ page, browserName }) => {
    test.skip(browserName !== "webkit", "WebKit is the engine without it")
    await page.goto("/lab/battery")
    await awaitClientHandover(page)
    await expect(page.getByTestId("battery-status")).toHaveText(
      "unsupported",
    )
    await expect(page.getByTestId("battery-level")).toHaveText("—")
    expect(await page.evaluate(() => "getBattery" in navigator)).toBe(
      false,
    )
  })
})

test.describe("Battery through a BatteryManager", () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "chromium is the engine with it")
    await page.addInitScript(() => {
      const target = new EventTarget()
      const manager = Object.assign(target, {
        level: 0.42,
        charging: true,
      })
      window.__battery = {
        get level() {
          return manager.level
        },
        set level(v: number) {
          manager.level = v
        },
        get charging() {
          return manager.charging
        },
        set charging(v: boolean) {
          manager.charging = v
        },
        fire: (t: string) => target.dispatchEvent(new Event(t)),
      }
      Object.defineProperty(navigator, "getBattery", {
        configurable: true,
        value: () => Promise.resolve(manager),
      })
    })
    await page.goto("/lab/battery")
    await awaitClientHandover(page)
  })

  test("shows the manager's numbers and follows its events without a reload", async ({
    page,
  }) => {
    await expect(page.getByTestId("battery-status")).toHaveText("ok")
    await expect(page.getByTestId("battery-level")).toHaveText("42%")
    await expect(page.getByTestId("battery-charging")).toHaveText("true")
    await page.evaluate(() => {
      const b = window.__battery
      if (!b) throw new Error("no fake battery")
      b.level = 0.17
      b.fire("levelchange")
      b.charging = false
      b.fire("chargingchange")
    })
    await expect(page.getByTestId("battery-level")).toHaveText("17%")
    await expect(page.getByTestId("battery-charging")).toHaveText("false")
  })
})
