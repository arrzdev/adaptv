// @vitest-environment node
// app-config.ts is the config's types plus three runtime values: `defineApp`,
// `ROUTER_BUILD_KEYS` and `resolveThemeColors`. The loader and error tests
// reach them through a whole config; these pin each one directly.
import { describe, expect, it } from "vitest"
import type { AdaptvThemeColor } from "#adaptv/config/app-config.ts"
import {
  defineApp,
  ROUTER_BUILD_KEYS,
  resolveThemeColors,
} from "#adaptv/config/app-config.ts"

describe("defineApp", () => {
  it("returns the very object it was given", () => {
    const config = {
      name: "Todos",
      description: "A list",
      themeColor: { light: "#fff" },
      styles: "./src/styles/main.css",
      router: {},
    }
    expect(defineApp(config)).toBe(config)
  })
})

describe("ROUTER_BUILD_KEYS", () => {
  it("names exactly the router keys adaptv keeps out of createRouter", () => {
    //`render` is a top-level key now; it must not come back here
    expect(ROUTER_BUILD_KEYS).toEqual([
      "serverEntry",
      "routesDirectory",
      "routerConfig",
    ])
  })
})

describe("resolveThemeColors", () => {
  it("keeps both sides when both are given", () => {
    expect(resolveThemeColors({ light: "#fff", dark: "#000" })).toEqual({
      light: "#fff",
      dark: "#000",
    })
  })

  it("uses the light colour for both when only light is given", () => {
    expect(resolveThemeColors({ light: "#fff" })).toEqual({
      light: "#fff",
      dark: "#fff",
    })
  })

  it("uses the dark colour for both when only dark is given", () => {
    expect(resolveThemeColors({ dark: "#000" })).toEqual({
      light: "#000",
      dark: "#000",
    })
  })

  it("throws when neither side is set", () => {
    //a JS config (or `as any`) can get past the type
    for (const themeColor of [
      {},
      { light: undefined, dark: undefined },
      { light: "", dark: "" },
    ])
      expect(() =>
        resolveThemeColors(themeColor as unknown as AdaptvThemeColor),
      ).toThrow("`themeColor` needs at least one of `light` / `dark`")
  })
})
