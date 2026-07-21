import { describe, expect, it } from "vitest"
import type { NativAppConfig } from "#nativ/config/app-config"
import { buildCapacitorConfig } from "#nativ/vite/capacitor-config"

const BASE: NativAppConfig = {
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
    expect(c.webDir).toBe("dist/client")
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
    const splash = buildCapacitorConfig(BASE).plugins.SplashScreen
    expect(splash.launchAutoHide).toBe(false)
    expect(splash.showSpinner).toBe(false)
    expect(splash.androidScaleType).toBe("CENTER_CROP")
  })

  it("edge-to-edge (StatusBar overlay) is always on", () => {
    expect(
      buildCapacitorConfig(BASE).plugins.StatusBar.overlaysWebView,
    ).toBe(true)
  })

  it("throws when appId is absent", () => {
    const { appId: _drop, ...noAppId } = BASE
    expect(() => buildCapacitorConfig(noAppId)).toThrow(/appId/i)
  })
})
