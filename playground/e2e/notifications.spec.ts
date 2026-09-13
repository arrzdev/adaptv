import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Local notifications on the web. A headless browser is not granted the
 * notification permission and cannot be asked interactively, so what the spec
 * pins is everything around the banner: the four-state row rather than a
 * boolean, the caveat naming the service worker, that scheduling for later is
 * refused in words instead of being faked with a timer, and that the pending
 * list stays empty because nothing on the web can hold one. The banner itself
 * is a device surface and is exercised on the simulator and the emulator.
 */

async function awaitClientHandover(page: Page) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
}

const FOUR_STATES = ["granted", "denied", "prompt", "unavailable"]

test.describe("Notifications", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/notifications")
    await awaitClientHandover(page)
  })

  test("the permission row is one of the four states and the caveat names the service worker", async ({
    page,
  }) => {
    const permission = page.getByTestId("notify-permission")
    await expect(permission).not.toHaveText("reading")
    expect(FOUR_STATES).toContain(
      ((await permission.textContent()) ?? "").trim(),
    )
    await expect(page.getByTestId("notify-caveat")).toContainText(
      "service worker",
    )
    await expect(page.getByTestId("notify-pending")).toHaveText("none")
    await expect(page.getByTestId("notify-last")).toHaveText("—")
  })

  test("scheduling for later is refused in words, and holds nothing", async ({
    page,
  }) => {
    await page.getByTestId("notify-later").click()
    await expect(page.getByTestId("notify-last")).toHaveText("unsupported")
    await expect(page.getByTestId("notify-pending")).toHaveText("none")
  })

  //Granting the permission is not the same as being able to show one, and this
  //is where the rule earns its keep: the dev server this suite runs against
  //registers no service worker, so a granted browser here must still read
  //`unavailable` rather than `granted`. Against a built app, where the worker
  //is registered, the same steps must show the notification and leave it with
  //the worker. The test asserts whichever of the two situations it is in, so it
  //keeps biting on both.
  //
  //This is also the regression test for reading the permission through the
  //Permissions API: a granted Chromium still reports `denied` on
  //`Notification.permission` and a granted WebKit reports `default`, so a
  //capability that read the constructor would call this row denied.
  test("a granted permission is only granted if a worker can carry it", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["notifications"])
    await page.reload()
    await awaitClientHandover(page)

    const hasWorker = await page.evaluate(
      async () => !!(await navigator.serviceWorker?.getRegistration()),
    )
    if (!hasWorker) {
      await expect(page.getByTestId("notify-permission")).toHaveText(
        "unavailable",
      )
      await page.getByTestId("notify-now").click()
      await expect(page.getByTestId("notify-last")).toHaveText(
        "unavailable",
      )
      return
    }

    await expect(page.getByTestId("notify-permission")).toHaveText(
      "granted",
    )
    await page.getByTestId("notify-now").click()
    await expect(page.getByTestId("notify-last")).toHaveText("shown")
    const held = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      const open = await reg?.getNotifications({ tag: "4001" })
      return (open ?? []).map((n) => ({ title: n.title, body: n.body }))
    })
    expect(held).toEqual([
      {
        title: "Two items saved",
        body: "This one was posted by the app itself.",
      },
    ])
  })

  test("showing one resolves without granting itself the permission it does not have", async ({
    page,
  }) => {
    await page.getByTestId("notify-now").click()
    await expect(page.getByTestId("notify-last")).not.toHaveText("—")
    const outcome = (
      (await page.getByTestId("notify-last").textContent()) ?? ""
    ).trim()
    expect(["shown", "prompt", "denied", "unavailable"]).toContain(outcome)
    if (outcome !== "shown") {
      //the refusal names the permission as it reads, so a browser that was
      //never asked says `prompt` rather than `denied`
      await expect(page.getByTestId("notify-permission")).toHaveText(
        outcome,
      )
    }
  })
})
