import { describe, expect, it } from "vitest"
import type { AdaptvAppConfig } from "#adaptv/config/app-config"
import {
  buildCapacitorConfig,
  MIN_ANDROID_WEBVIEW,
} from "#adaptv/vite/capacitor-config"

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
