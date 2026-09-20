import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The status-bar resample: in an installed web app, an OS appearance switch moves the URL to a
 * hash and straight back (`useSyncTheme`, `resampleStatusBarFill`), because iOS 26.1 latches a
 * black scrim over the status-bar strip on a light→dark switch until a same-document navigation.
 *
 * The strip itself is painted by the OS, outside the page, and was measured on a simulator. What
 * a browser CAN check is the part that could break the app: the detour must be invisible to it.
 * The router's location, the history length, the URL and `history.state` are the same after the
 * switch, and no `popstate` or `hashchange` fires, while the detour provably ran (the two native
 * calls are counted, so the test cannot pass on a hook that never subscribed).
 *
 * "Installed" is faked with `navigator.standalone`, as in `edge-swipe.spec.ts`, and "iOS" with an
 * iPhone user agent (the webkit project already is one): the hook gates on `resolvePlatformTag()`
 * and `getOS()`, which read exactly those, and the test asserts the stamps agree.
 *
 * The playground sets `memoryHistoryInStandalone`, so this runs the router on memory history; the
 * browser-history wrapper is covered by the hook's unit test with TanStack's real
 * `createBrowserHistory`.
 */

test.use({ viewport: { width: 390, height: 844 }, colorScheme: "light" })

/** Count the native replaceState calls, and the events the detour must never fire. */
async function instrument(page: Page, installed: boolean) {
  await page.addInitScript((standalone) => {
    if (standalone) {
      Object.defineProperty(window.navigator, "standalone", {
        value: true,
        configurable: true,
      })
      Object.defineProperty(window.navigator, "userAgent", {
        value:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
        configurable: true,
      })
    }
    const probe = { detours: 0, popstate: 0, hashchange: 0 }
    ;(window as unknown as { __resample: typeof probe }).__resample = probe
    const native = History.prototype.replaceState
    History.prototype.replaceState = function (
      this: History,
      ...args: Parameters<History["replaceState"]>
    ) {
      if (String(args[2] ?? "").includes("#adaptv-status-bar"))
        probe.detours++
      return native.apply(this, args)
    }
    window.addEventListener("popstate", () => probe.popstate++)
    window.addEventListener("hashchange", () => probe.hashchange++)
  }, installed)
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const router = window.__TSR_ROUTER__
    return {
      platform: document.documentElement.dataset.adaptvPlatform,
      os: document.documentElement.dataset.adaptvOs,
      href: location.href,
      state: JSON.stringify(history.state),
      length: history.length,
      routerHref: router?.state.location.href,
      routerLength: router?.history.length,
      probe: (window as unknown as { __resample: object }).__resample,
    }
  })
}

test("an OS appearance switch in the installed app leaves the router where it was", async ({
  page,
}) => {
  await instrument(page, true)
  await page.goto("/lab")
  await awaitClientHandover(page)

  const before = await snapshot(page)
  expect(
    before.platform,
    "the app did not resolve as installed — the hook under test is off",
  ).toBe("standalone")
  expect(
    before.os,
    "the app did not resolve as iOS — the hook is off",
  ).toBe("ios")

  await page.emulateMedia({ colorScheme: "dark" })
  await expect
    .poll(() => snapshot(page).then((s) => s.probe))
    .toEqual({ detours: 1, popstate: 0, hashchange: 0 })
  await page.emulateMedia({ colorScheme: "light" })
  await expect
    .poll(() => snapshot(page).then((s) => s.probe))
    .toEqual({ detours: 2, popstate: 0, hashchange: 0 })

  //a late event would land after the polls above; give the event loop a turn
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)))
  const after = await snapshot(page)
  expect(after).toEqual({
    ...before,
    probe: { detours: 2, popstate: 0, hashchange: 0 },
  })
})

test("a browser tab does not take the detour", async ({ page }) => {
  await instrument(page, false)
  await page.goto("/lab")
  await awaitClientHandover(page)
  expect((await snapshot(page)).platform).toBe("web")

  await page.emulateMedia({ colorScheme: "dark" })
  //the theme follows the OS in a tab too, so wait for that before reading the count
  await expect(page.locator("html")).toHaveClass(/\bdark\b/)
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)))
  expect((await snapshot(page)).probe).toEqual({
    detours: 0,
    popstate: 0,
    hashchange: 0,
  })
})
