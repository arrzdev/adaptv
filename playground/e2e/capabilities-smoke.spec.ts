import { expect, test } from "@playwright/test"

/*
 * Capabilities smoke — every capability page renders and throws no UNCAUGHT error on
 * the web target, INCLUDING the many whose whole job on the web is to report "not
 * supported here". A capability page white-screening — a native call made at render,
 * an unguarded `window`/`navigator` access — is invisible to typecheck, lint and
 * every component's own suite; this is the gate that catches it.
 *
 * The behaviour a browser can actually drive gets its own dedicated spec (network,
 * keyboard, geolocation, clipboard); the device-only capabilities are walked on the
 * simulator, and here we only prove they mount and self-report their support state.
 *
 * Note: TanStack Router's preload throws `_nonReactive` in this workspace from a
 * version skew — a CAUGHT console.error, not a pageerror, so it neither trips this
 * assertion nor should it (uncaught errors are the white-screen signal).
 */

const PAGES = [
  ["/lab/share", "Share"],
  ["/lab/clipboard", "Clipboard"],
  ["/lab/device", "Device"],
  ["/lab/orientation", "Orientation"],
  ["/lab/keep-awake", "Keep awake"],
  ["/lab/app-state", "App state"],
  ["/lab/back-chain", "Back chain"],
  ["/lab/browser", "Browser"],
  ["/lab/geolocation", "Geolocation"],
  ["/lab/gesture-controller", "Gesture controller"],
  ["/lab/haptic-tick", "Haptic tick"],
  ["/lab/haptics", "Haptics"],
  ["/lab/keyboard", "Keyboard"],
  ["/lab/native-theme", "Native theme"],
  ["/lab/network", "Network"],
  ["/lab/splash", "Splash"],
  ["/lab/status-bar", "Status bar"],
  ["/lab/hooks", "Standalone hooks"],
] as const

test.describe.configure({ retries: 2 })

test.describe("Capabilities smoke", () => {
  for (const [route, title] of PAGES) {
    test(`${title} mounts and throws nothing uncaught`, async ({
      page,
    }) => {
      const errors: string[] = []
      page.on("pageerror", (e) => errors.push(String(e)))

      await page.goto(route)
      await expect(
        page.getByRole("heading", { level: 1, name: title }),
      ).toBeVisible()
      // settled with content, not a blank error shell
      expect(
        await page.locator("body").evaluate((b) => b.childElementCount),
      ).toBeGreaterThan(0)
      expect(
        errors,
        `uncaught error on ${route}:\n${errors.join("\n")}`,
      ).toEqual([])
    })
  }
})
