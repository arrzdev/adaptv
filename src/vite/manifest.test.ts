import { describe, expect, it } from "vitest"
import type { NativAppConfig } from "#nativ/config/app-config"
import { resolveThemeColors } from "#nativ/config/app-config"
import { buildManifest, parseIconSize } from "#nativ/vite/manifest"

const BASE: NativAppConfig = {
  name: "ChopChop",
  description: "A focused task list.",
  themeColor: { light: "#eeeeec", dark: "#0a0a0c" },
  backgroundColor: "#f7f7f5",
  orientation: "portrait",
  styles: "./src/styles/main.css",
  //point at a dir with no icons so the field maps deterministically without disk fixtures
  icons: "./__no_icons__",
  router: {
    clientEntry: "../entrypoint/client",
    routesDirectory: "./routing",
    routerConfig: "./src/routing/config.ts",
  },
}

describe("parseIconSize", () => {
  it("parses explicit WxH", () => {
    expect(parseIconSize("android-icon-36x36.png")).toBe("36x36")
    expect(parseIconSize("android-icon-144x144.png")).toBe("144x144")
  })

  it("treats a single trailing number as square", () => {
    expect(parseIconSize("android-chrome-192.png")).toBe("192x192")
    expect(parseIconSize("android-chrome-512.png")).toBe("512x512")
  })

  it("returns null when no size is present", () => {
    expect(parseIconSize("favicon.ico")).toBeNull()
    expect(parseIconSize("pinned-tab.svg")).toBeNull()
  })
})

describe("buildManifest", () => {
  it("maps config fields to manifest fields", () => {
    const manifest = buildManifest(BASE, "/tmp")
    expect(manifest.name).toBe("ChopChop")
    expect(manifest.short_name).toBe("ChopChop")
    expect(manifest.start_url).toBe("/")
    expect(manifest.display).toBe("standalone")
    //theme_color defaults to the LIGHT theme (seeds launch chrome; useSyncTheme
    //takes over the live theme-color meta once mounted)
    expect(manifest.theme_color).toBe("#eeeeec")
    expect(manifest.background_color).toBe("#f7f7f5")
    expect(manifest.orientation).toBe("portrait")
  })

  it("defaults short_name to name and background to light theme", () => {
    const { backgroundColor: _drop, shortName: _drop2, ...rest } = BASE
    const manifest = buildManifest(rest, "/tmp")
    expect(manifest.short_name).toBe("ChopChop")
    expect(manifest.background_color).toBe("#eeeeec")
  })

  it("omits orientation when 'any'", () => {
    const manifest = buildManifest({ ...BASE, orientation: "any" }, "/tmp")
    expect(manifest.orientation).toBeUndefined()
  })

  it("merges manifestExtra verbatim", () => {
    const manifest = buildManifest(
      { ...BASE, manifestExtra: { categories: ["productivity"] } },
      "/tmp",
    )
    expect(manifest.categories).toEqual(["productivity"])
  })

  it("uses the single color for both when themeColor is light-only", () => {
    const { backgroundColor: _drop, ...rest } = BASE
    const manifest = buildManifest(
      { ...rest, themeColor: { light: "#eeeeec" } },
      "/tmp",
    )
    expect(manifest.theme_color).toBe("#eeeeec")
    expect(manifest.background_color).toBe("#eeeeec")
  })

  it("uses the single color for both when themeColor is dark-only", () => {
    const { backgroundColor: _drop, ...rest } = BASE
    const manifest = buildManifest(
      { ...rest, themeColor: { dark: "#0a0a0c" } },
      "/tmp",
    )
    expect(manifest.theme_color).toBe("#0a0a0c")
    expect(manifest.background_color).toBe("#0a0a0c")
  })
})

describe("resolveThemeColors", () => {
  it("keeps both when both are provided", () => {
    expect(
      resolveThemeColors({ light: "#eeeeec", dark: "#0a0a0c" }),
    ).toEqual({
      light: "#eeeeec",
      dark: "#0a0a0c",
    })
  })

  it("falls back dark → light when only light is given", () => {
    expect(resolveThemeColors({ light: "#eeeeec" })).toEqual({
      light: "#eeeeec",
      dark: "#eeeeec",
    })
  })

  it("falls back light → dark when only dark is given", () => {
    expect(resolveThemeColors({ dark: "#0a0a0c" })).toEqual({
      light: "#0a0a0c",
      dark: "#0a0a0c",
    })
  })
})
