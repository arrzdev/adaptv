import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Motion on the two engines the suite runs. Chromium has DeviceMotionEvent on
 * the localhost origin and lets a page construct and dispatch one, so the
 * rows are driven with synthetic events; the machine's own all-null event is
 * what the silent row is about. Playwright's WebKit under the iPhone 13
 * descriptor (measured 2026-09-02 on localhost, the secure origin) has the
 * constructor, no requestPermission, refuses `new DeviceMotionEvent` as an
 * illegal constructor and never fires: granted, then silent. Desktop WebKit
 * without the descriptor has no constructor at all. The row here pins the
 * emulated engine the suite runs.
 */

test.describe("Motion where the engine has the API and no sensor", () => {
  test("is granted and goes silent on emulated WebKit", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "webkit", "the iPhone-descriptor WebKit row")
    await page.goto("/lab/motion")
    await awaitClientHandover(page)
    await expect(page.getByTestId("motion-secure")).toHaveText("true")
    await expect(page.getByTestId("motion-status")).toHaveText("granted")
    await expect(page.getByTestId("motion-silent")).toHaveText("true", {
      timeout: 5_000,
    })
    await expect(page.getByTestId("motion-count")).toHaveText("0")
    expect(
      await page.evaluate(() => ({
        ctor: typeof DeviceMotionEvent,
        ask: typeof (DeviceMotionEvent as { requestPermission?: unknown })
          .requestPermission,
      })),
    ).toEqual({ ctor: "function", ask: "undefined" })
  })
})

test.describe("Motion through devicemotion", () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "chromium is the engine with it")
    await page.goto("/lab/motion")
    await awaitClientHandover(page)
  })

  test("is granted, goes silent without a sensor, then tracks synthetic samples", async ({
    page,
  }) => {
    await expect(page.getByTestId("motion-status")).toHaveText("granted")
    await expect(page.getByTestId("motion-secure")).toHaveText("true")
    await expect(page.getByTestId("motion-silent")).toHaveText("true", {
      timeout: 5_000,
    })
    await page.evaluate(() => {
      window.dispatchEvent(
        new DeviceMotionEvent("devicemotion", {
          accelerationIncludingGravity: { x: 1, y: 2, z: 9.81 },
          rotationRate: { alpha: 10, beta: 20, gamma: 30 },
          interval: 16,
        }),
      )
    })
    await expect(page.getByTestId("motion-silent")).toHaveText("false")
    await expect(page.getByTestId("motion-gravity")).toHaveText(
      "1.00 / 2.00 / 9.81",
    )
    await expect(page.getByTestId("motion-rotation")).toHaveText(
      "10.00 / 20.00 / 30.00",
    )
    await expect(page.getByTestId("motion-count")).toHaveText("1")
  })
})
