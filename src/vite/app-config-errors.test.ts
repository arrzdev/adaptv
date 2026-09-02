import { describe, expect, it } from "vitest"
import { appConfigErrors } from "#adaptv/vite/app-config-errors"

/** The smallest config the build can produce an app from. */
const ok = {
  name: "Probe",
  description: "d",
  themeColor: { light: "#eeeeec", dark: "#0a0a0c" },
  styles: "./src/styles/main.css",
  router: { routesDirectory: "./routing" },
}

describe("appConfigErrors", () => {
  it("accepts a config the build can use", () => {
    expect(appConfigErrors(ok)).toEqual([])
  })

  it("accepts every optional key at a valid value", () => {
    expect(
      appConfigErrors({
        ...ok,
        appId: "com.example.my_app_2",
        backgroundColor: "#FFF",
        splashMaskLightColor: "#ffffff",
        splashMaskDarkColor: "#000",
        icons: "./public/favicons",
        orientation: "portrait",
        render: "spa",
        serviceWorkerUpdate: "prompt",
        defaultThemePreference: "system",
        splashMaskMode: "preferences",
        otaOnNativeSkew: "refuse",
        otaPollMinutes: 0,
        updateRequiredAfterDays: 30,
        plugins: ["@capacitor/camera"],
        serviceWorkers: ["./src/sw/probe.ts"],
      }),
    ).toEqual([])
  })

  it("refuses anything that is not an object", () => {
    expect(appConfigErrors(undefined)).toEqual([
      "the config must be an object",
    ])
    expect(appConfigErrors([])).toEqual(["the config must be an object"])
  })

  //Reproduced on the playground with plain `vite build` (2026-09-02): `name`
  //missing built a manifest with no name; `styles` missing died with
  //`TypeError: Cannot read properties of undefined (reading 'replace')`;
  //`themeColor` missing with `... (reading 'light')`. None named the key.
  it("names each required key the build reads unconditionally", () => {
    expect(appConfigErrors({ description: ok.description })).toEqual([
      "'name' must be the app's name, got undefined",
      "'styles' must be a path to the app's stylesheet, got undefined",
      "'router' must be an object, got undefined",
      "'themeColor' needs at least one of 'light' / 'dark'",
    ])
  })

  it("treats an empty string as missing", () => {
    expect(appConfigErrors({ ...ok, name: "  ", styles: "" })).toEqual([
      "'name' must be the app's name, got \"  \"",
      "'styles' must be a path to the app's stylesheet, got \"\"",
    ])
  })

  it("refuses a routes directory that is not a path", () => {
    //`path.resolve` threw `The "paths[2]" argument must be of type string`
    //from inside the plugin, naming no key (playground, 2026-09-02)
    expect(
      appConfigErrors({ ...ok, router: { routesDirectory: 42 } }),
    ).toEqual([
      "'router.routesDirectory' must be a path to the routes directory, got 42",
    ])
  })

  it("is the sentence the CLI's preflight prints — it calls this", () => {
    //`bin/lib/preflight.mjs` `configErrors` delegates here, so the two faces
    //cannot disagree about one value. These are the rows it used to print
    //from its own copy, kept verbatim.
    expect(appConfigErrors({ ...ok, appId: "myapp" })).toEqual([
      "'appId' must be reverse-DNS like com.example.app, got \"myapp\"",
    ])
    expect(appConfigErrors({ ...ok, appId: 123 })).toEqual([
      "'appId' must be reverse-DNS like com.example.app, got 123",
    ])
    expect(
      appConfigErrors({ ...ok, themeColor: { light: "midnightblue" } }),
    ).toEqual([
      "'themeColor.light' must be a hex colour like #1b1b1b, got \"midnightblue\"",
    ])
    expect(appConfigErrors({ ...ok, splashMaskMode: "auto" })).toEqual([
      "'splashMaskMode' must be preferences, system, light or dark, got \"auto\"",
    ])
    expect(appConfigErrors({ ...ok, icons: ["a.png"] })).toEqual([
      "'icons' must be a path to the app's icon directory, got [\"a.png\"]",
    ])
  })

  it("refuses a colour that is not a hex colour, wherever it sits", () => {
    expect(
      appConfigErrors({
        ...ok,
        backgroundColor: "white",
        splashMaskDarkColor: 0,
      }),
    ).toEqual([
      "'backgroundColor' must be a hex colour like #1b1b1b, got \"white\"",
      "'splashMaskDarkColor' must be a hex colour like #1b1b1b, got 0",
    ])
  })

  it("refuses a value outside a closed set instead of shipping it", () => {
    //`orientation: "sideways"` and `render: "static"` both built green on the
    //playground — the first into the manifest, the second treated as SSR
    expect(
      appConfigErrors({
        ...ok,
        orientation: "sideways",
        render: "static",
        serviceWorkerUpdate: "manual",
        defaultThemePreference: "auto",
        otaOnNativeSkew: "ignore",
      }),
    ).toEqual([
      "'orientation' must be portrait, landscape or any, got \"sideways\"",
      "'render' must be ssr or spa, got \"static\"",
      "'serviceWorkerUpdate' must be auto or prompt, got \"manual\"",
      "'defaultThemePreference' must be light, dark or system, got \"auto\"",
      "'otaOnNativeSkew' must be install or refuse, got \"ignore\"",
    ])
  })

  it("refuses a number written as a string", () => {
    //`otaPollMinutes: "5"` built green: the comparison coerced it
    expect(
      appConfigErrors({
        ...ok,
        otaPollMinutes: "5",
        updateRequiredAfterDays: Number.NaN,
      }),
    ).toEqual([
      "'otaPollMinutes' must be a number of minutes, got \"5\"",
      "'updateRequiredAfterDays' must be a number of days, got null",
    ])
  })

  it("refuses a list that is not a list of strings", () => {
    expect(
      appConfigErrors({
        ...ok,
        plugins: "@capacitor/camera",
        serviceWorkers: [1],
      }),
    ).toEqual([
      "'plugins' must be a list of package names, got \"@capacitor/camera\"",
      "'serviceWorkers' must be a list of file paths, got [1]",
    ])
  })

  it("reports every problem at once, not the first", () => {
    const errors = appConfigErrors({
      name: "",
      themeColor: "#fff",
      orientation: "flat",
    })
    expect(errors).toHaveLength(5)
    expect(errors.map((e) => e.slice(0, e.indexOf("'", 1) + 1))).toEqual([
      "'name'",
      "'styles'",
      "'router'",
      "'themeColor'",
      "'orientation'",
    ])
  })
})
