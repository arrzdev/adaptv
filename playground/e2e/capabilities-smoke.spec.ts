import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

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
 * The assertion is on `pageerror` — UNCAUGHT errors — AND on `console.error`. It
 * used to be `pageerror` alone, on the theory that an error the app handles and
 * reports itself is not a white screen. Two runtime errors then went through it: a
 * `<div>` inside a `<p>` that failed hydration on every load (React logs it, catches
 * it, regenerates the tree on the client, and the page looks right), and the
 * network-refused lines the debug telemetry adds when it forwards that error to a
 * log sink that is not running. Neither was uncaught, both were bugs, and nothing
 * else in the suite reads the console. So this spec does, and the only thing it
 * excuses is listed by name in {@link KNOWN_CONSOLE_ERRORS} with the reason.
 */

/**
 * Console errors this spec does NOT fail on. Each entry is a filed, understood
 * error with a reason; there is no wildcard, and a new error is a failure until
 * someone writes its line here. Empty on purpose: the one known handled error in
 * the app — TanStack Router's preload path throwing `_nonReactive` on a
 * react-router/router-core version skew (see link.spec.ts) — fires from a link
 * being hovered or tapped, which nothing here does: a full run on both engines
 * and six repeats of this spec never saw it on these routes. It is not excused
 * ahead of time; if it ever shows up here the failure names it, and the line is
 * one entry — with the follow-on the debug telemetry adds when it forwards that
 * console.error to a log sink that is not running, which is why an entry that
 * matched only the TypeError would not even make the test pass.
 */
const KNOWN_CONSOLE_ERRORS: { pattern: RegExp; reason: string }[] = []

/** The known errors are excused; everything else is the failure this spec exists for. */
function isKnown(text: string): boolean {
  return KNOWN_CONSOLE_ERRORS.some(({ pattern }) => pattern.test(text))
}

const PAGES = [
  ["/lab/share", "Share"],
  ["/lab/compose", "Compose"],
  ["/lab/clipboard", "Clipboard"],
  ["/lab/device", "Device"],
  ["/lab/locale", "Locale"],
  ["/lab/orientation", "Orientation"],
  ["/lab/keep-awake", "Keep awake"],
  ["/lab/speech", "Speech"],
  ["/lab/app-state", "App state"],
  ["/lab/back-chain", "Back chain"],
  ["/lab/browser", "Browser"],
  ["/lab/geolocation", "Geolocation"],
  ["/lab/gesture-controller", "Gesture controller"],
  ["/lab/haptic-tick", "Haptic tick"],
  ["/lab/haptics", "Haptics"],
  ["/lab/keyboard", "Keyboard"],
  ["/lab/native-theme", "Native theme"],
  ["/lab/motion", "Motion"],
  ["/lab/network", "Network"],
  ["/lab/splash", "Splash"],
  ["/lab/status-bar", "Status bar"],
  ["/lab/hooks", "Standalone hooks"],
] as const

test.describe("Capabilities smoke", () => {
  for (const [route, title] of PAGES) {
    test(`${title} mounts and throws nothing uncaught`, async ({
      page,
    }) => {
      const errors: string[] = []
      page.on("pageerror", (e) => errors.push(`uncaught: ${String(e)}`))
      page.on("console", (message) => {
        if (message.type() !== "error") return
        const text = message.text()
        if (!isKnown(text)) errors.push(`console.error: ${text}`)
      })

      await page.goto(route)
      await awaitClientHandover(page)
      await expect(
        page.getByRole("heading", { level: 1, name: title }),
      ).toBeVisible()
      // settled with content, not a blank error shell
      expect(
        await page.locator("body").evaluate((b) => b.childElementCount),
      ).toBeGreaterThan(0)
      expect(errors, `error on ${route}:\n${errors.join("\n")}`).toEqual(
        [],
      )
    })
  }
})
