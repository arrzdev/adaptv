// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

/**
 * There is ONE implementation of "what colour is this app, per appearance", and these tests
 * exist to keep it that way rather than to check what it answers.
 *
 * `resolveIconPlan` and `resolveSplashMask` each spelled `theme.dark ?? theme.light` out by
 * hand, next to a `resolveThemeColors` in `src/config/app-config.ts` that every other
 * consumer already went through — the manifest, the emitted shell, the root route, the
 * offline page. Three copies of one rule agreeing today, and answerable to nobody tomorrow:
 * a fallback, a normalisation or a validation added to the resolver would leave the native
 * launcher and splash on the old rule, with nothing failing, and the two halves of the app
 * painting different colours from the same config.
 *
 * Asserting on the colours could not have caught that, because the copies agreed. So the
 * resolver is REPLACED here with one that ignores its input and answers with sentinels the
 * config never mentions. Anything that reaches the config's own `light`/`dark` without going
 * through it comes back with a colour these tests do not expect, and a re-inlined fallback
 * fails on the first case.
 */
const RESOLVED = { light: "#111111", dark: "#222222" }
const resolveThemeColors = vi.fn(() => RESOLVED)

vi.mock("./load-ts.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    loadAdaptvModule: async (rel) =>
      rel === "config/app-config.ts"
        ? { resolveThemeColors }
        : actual.loadAdaptvModule(rel),
  }
})

const { resolveSplashMask } = await import("./native.mjs")

//Both sides present, so a hand-rolled `?? ` chain would never even reach its fallback arm and
//would still return the config's own colours. This is the case a value assertion misses.
const BOTH = { themeColor: { light: "#eeeeec", dark: "#0a0a0c" } }
//The case the fallback exists for: one side of the app has no colour of its own.
const ONE_SIDED = { themeColor: { light: "#eeeeec" } }

describe("the native theme colours come from the shared resolver", () => {
  it("resolves both splash-mask colours through it", async () => {
    expect(await resolveSplashMask(BOTH)).toEqual({
      light: RESOLVED.light,
      dark: RESOLVED.dark,
      follow: "preferences",
    })
  })

  it("hands it the config's own themeColor, untouched", async () => {
    resolveThemeColors.mockClear()
    await resolveSplashMask(BOTH)
    expect(resolveThemeColors).toHaveBeenCalledWith(BOTH.themeColor)
  })

  it("goes through it for the one-sided config too", async () => {
    //The arm a hand-rolled copy exists to serve. It must not be served locally.
    expect(await resolveSplashMask(ONE_SIDED)).toEqual({
      light: RESOLVED.light,
      dark: RESOLVED.dark,
      follow: "preferences",
    })
  })

  it("still lets the app's own splash colours outrank it", async () => {
    //The overrides are this function's OWN rule, not a second copy of the theme fallback, so
    //they stay here and must keep winning.
    expect(
      await resolveSplashMask({
        ...BOTH,
        splashMaskLightColor: "#ffffff",
        splashMaskDarkColor: "#000000",
      }),
    ).toEqual({ light: "#ffffff", dark: "#000000", follow: "preferences" })
    expect(
      await resolveSplashMask({ ...BOTH, backgroundColor: "#fafafa" }),
    ).toEqual({
      light: "#fafafa",
      dark: RESOLVED.dark,
      follow: "preferences",
    })
  })
})
