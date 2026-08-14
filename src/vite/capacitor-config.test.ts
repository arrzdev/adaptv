import { afterEach, describe, expect, it, vi } from "vitest"
import type { AdaptvAppConfig } from "#adaptv/config/app-config"
import { BOOT_GRACE_MS } from "#adaptv/shell/boot-fallback"
import {
  buildCapacitorConfig,
  MIN_ANDROID_WEBVIEW,
  OTA_READY_TIMEOUT_MS,
} from "#adaptv/vite/capacitor-config"
import { resolveOtaPublicKey } from "#adaptv/vite/ota-config-module"

const BASE: AdaptvAppConfig = {
  name: "ChopChop",
  description: "A focused task list.",
  themeColor: { light: "#eeeeec", dark: "#0a0a0c" },
  backgroundColor: "#ffffff",
  styles: "./src/styles/main.css",
  appId: "com.chopchop.app",
  router: {
    routesDirectory: "./routing",
    routerConfig: "./src/routing/config.ts",
  },
}

describe("buildCapacitorConfig", () => {
  it("maps appId and defaults appName to the app name", () => {
    const c = buildCapacitorConfig(BASE)
    expect(c.appId).toBe("com.chopchop.app")
    expect(c.appName).toBe("ChopChop")
    expect(c.webDir).toBe(".adaptv/web")
  })

  it("relocates the native projects into the hidden .adaptv/ dir", () => {
    const c = buildCapacitorConfig(BASE)
    expect(c.android.path).toBe(".adaptv/android")
    expect(c.ios.path).toBe(".adaptv/ios")
  })

  it("honours an explicit appName", () => {
    const c = buildCapacitorConfig({ ...BASE, appName: "Chop" })
    expect(c.appName).toBe("Chop")
  })

  it("sets no plugin backgroundColor (a fixed colour can't follow the theme; the theme-aware html bg shows through)", () => {
    const splash = buildCapacitorConfig({
      ...BASE,
      splashMaskLightColor: "#abcdef",
    }).plugins.SplashScreen
    expect(splash).not.toHaveProperty("backgroundColor")
  })

  it("holds the launch splash until the app hands off (no auto-hide gap)", () => {
    const splash = buildCapacitorConfig(BASE).plugins
      .SplashScreen as Record<string, unknown>
    expect(splash.launchAutoHide).toBe(false)
    expect(splash.showSpinner).toBe(false)
    expect(splash.androidScaleType).toBe("CENTER_CROP")
  })

  it("edge-to-edge (StatusBar overlay) is always on", () => {
    const statusBar = buildCapacitorConfig(BASE).plugins
      .StatusBar as Record<string, unknown>
    expect(statusBar.overlaysWebView).toBe(true)
  })

  // Replaces Capacitor's default of 60, which is unreachable and so can never fire (B21).
  // Deliberately BELOW the 113–118 ring bug: that is patched in the CSS
  // (vite/ring-shadow-fallback.ts), so gating those devices out would refuse hardware
  // adaptv renders correctly. 111 is Tailwind v4's own stated minimum.
  it("floors the Android WebView at Tailwind v4's minimum, not at the ring bug", () => {
    const android = buildCapacitorConfig(BASE).android
    expect(android.minWebViewVersion).toBe(111)
    expect(MIN_ANDROID_WEBVIEW).toBe(111)
  })

  // The gate has no UI of its own: Capacitor loads `server.errorPath` for a too-old
  // WebView exactly as it does for a failed load. With no errorPath it only logs and boots
  // the app anyway, so production shipping this page is what makes the floor real.
  it("ships an errorPath in production, so the floor is not a silent no-op", () => {
    //the literal, not the CLI's constant: this IS the contract between them, and
    //`offline-page.test.mjs` asserts the other side of it.
    expect(buildCapacitorConfig(BASE).server?.errorPath).toBe(
      "adaptv-offline.html",
    )
  })

  it("configures SystemBars insetsHandling:css so Android injects --safe-area-inset-*", () => {
    //The native half of the safe-area contract (DECISIONS.md §6.0): Capacitor 8 core
    //injects the CSS vars styles/safe-area.css consumes var-first, working around
    //broken env() in Android WebView < 140.
    const systemBars = buildCapacitorConfig(BASE).plugins
      .SystemBars as Record<string, unknown>
    expect(systemBars.insetsHandling).toBe("css")
    expect(systemBars.style).toBe("DEFAULT")
  })

  it("throws when appId is absent", () => {
    const { appId: _drop, ...noAppId } = BASE
    expect(() => buildCapacitorConfig(noAppId)).toThrow(/appId/i)
  })
})

// The plugin ships `readyTimeout: 0`, and 0 means the watchdog does not exist —
// a bundle that never boots is never reverted, on every installed device at once.
// It also silently disables `autoBlockRolledBackBundles`, so a zero here costs two
// defences, not one. → LIFECYCLE.md §5.5
describe("the update watchdog", () => {
  const withOta: AdaptvAppConfig = {
    ...BASE,
    origin: "https://app.example.com",
  } as AdaptvAppConfig

  it("is armed whenever a channel is configured", () => {
    const live = buildCapacitorConfig(withOta).plugins.LiveUpdate as {
      readyTimeout: number
      autoBlockRolledBackBundles: boolean
    }
    expect(live.readyTimeout).toBe(OTA_READY_TIMEOUT_MS)
    expect(live.readyTimeout).toBeGreaterThan(0)
    expect(live.autoBlockRolledBackBundles).toBe(true)
  })

  it("outlasts the boot fallback by a real margin, not by a hair", () => {
    //The two clocks start at different moments: this one in the plugin's
    //constructor, BOOT_GRACE_MS at DOMContentLoaded. The gap between them is the
    //whole native boot — 1–3 s on a slow Android cold start — so a value merely
    //greater than BOOT_GRACE_MS can still fire first and roll back a bundle that
    //was only slow. A false rollback is worse than no rollback. → §5.4
    expect(OTA_READY_TIMEOUT_MS - BOOT_GRACE_MS).toBeGreaterThanOrEqual(
      3000,
    )
  })

  it("never lets the plugin run its own update loop", () => {
    //`background` would check and apply on its own schedule, racing
    //startOtaUpdates over the same pointer — two policies, no owner. → §5.5
    const live = buildCapacitorConfig(withOta).plugins.LiveUpdate as {
      autoUpdateStrategy: string
      autoDeleteBundles: boolean
    }
    expect(live.autoUpdateStrategy).toBe("none")
    //"unused" would include the last known-good bundle: the rollback target
    expect(live.autoDeleteBundles).toBe(false)
  })

  it("stays absent when there is no channel to update from", () => {
    //nothing would ever call markBundleReady(), so the timer could only expire
    expect(buildCapacitorConfig(BASE).plugins.LiveUpdate).toBeUndefined()
  })
})

describe("the key the native half verifies against", () => {
  const signed: AdaptvAppConfig = {
    ...BASE,
    origin: "https://app.example.com",
    otaPublicKey: "PEM-CONFIG",
  } as AdaptvAppConfig

  const live = (config: AdaptvAppConfig) =>
    buildCapacitorConfig(config).plugins.LiveUpdate as {
      publicKey?: string
    }

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("is the app's declared key", () => {
    expect(live(signed).publicKey).toBe("PEM-CONFIG")
  })

  it("is omitted entirely when the app declares none", () => {
    //🔴 Not an empty string: the plugin verifies only when the key is PRESENT, so
    //an empty value would read as "no key" while looking configured.
    const unsigned = {
      ...BASE,
      origin: "https://app.example.com",
    } as AdaptvAppConfig
    expect(live(unsigned)).not.toHaveProperty("publicKey")
  })

  it("follows the same override the JS half follows", () => {
    //The failure this forecloses has no local symptom: native trusting the
    //committed key while JS trusts the override means the bundle downloads, the
    //zip verifies, and the manifest check then refuses it — on the device only.
    vi.stubEnv("ADAPTV_OTA_ORIGIN", "http://localhost:41790")
    vi.stubEnv("ADAPTV_OTA_PUBLIC_KEY", "PEM-LOCAL")
    expect(live(signed).publicKey).toBe("PEM-LOCAL")
    expect(resolveOtaPublicKey(signed)).toBe("PEM-LOCAL")
  })

  it("ignores the override on a build that was not pointed at a local channel", () => {
    //One variable must never be enough to move a production build's trust anchor.
    vi.stubEnv("ADAPTV_OTA_PUBLIC_KEY", "PEM-LOCAL")
    expect(live(signed).publicKey).toBe("PEM-CONFIG")
  })
})
