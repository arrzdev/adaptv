import { readFileSync } from "node:fs"
import path from "node:path"
import { Preferences } from "@capacitor/preferences"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  NATIVE_THEME_PREF_KEY,
  persistNativeThemePreference,
} from "#adaptv/capabilities/native-theme"
import type { UiThemePreference } from "#adaptv/hooks/use-theme"

//Capacitor's Preferences is a registerPlugin proxy (no own methods to spyOn), so
//mock the module with fakes. The capability reaches it through `await import(…)`,
//which this covers the same way it covers a static import.
const prefsStore = new Map<string, string>()
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      prefsStore.set(key, value)
    }),
  },
}))

function forceNative(native: boolean): void {
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
}

/** Every value the preference can hold — the union `use-theme` publishes. */
const PREFERENCES: UiThemePreference[] = ["light", "dark", "system"]

beforeEach(() => {
  prefsStore.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("persistNativeThemePreference — the native branch", () => {
  /*
   * Verbatim, all three values, no mapping. The native launch code compares this
   * string for EQUALITY (`"dark".equals(pref)` in MainActivity, `== "dark"` in
   * AppDelegate) and falls back to the system appearance on anything it does not
   * recognise — so normalising, casing or abbreviating here would not throw
   * anywhere, it would just make the splash quietly stop following the app.
   */
  it.each(PREFERENCES)(
    "writes `%s` under the launch key, unchanged",
    async (preference) => {
      forceNative(true)
      await persistNativeThemePreference(preference)
      expect(Preferences.set).toHaveBeenCalledWith({
        key: NATIVE_THEME_PREF_KEY,
        value: preference,
      })
      expect(prefsStore.get(NATIVE_THEME_PREF_KEY)).toBe(preference)
    },
  )
})

describe("persistNativeThemePreference — off native", () => {
  it("is a no-op on web and never throws", async () => {
    forceNative(false)
    await expect(
      persistNativeThemePreference("dark"),
    ).resolves.toBeUndefined()
    expect(Preferences.set).not.toHaveBeenCalled()
    expect(prefsStore.size).toBe(0)
  })
})

/*
 * The whole module is a fire-and-forget write on the theme-flip path: the caller
 * is changing what the user is looking at, and the only thing riding on this call
 * is what the OS paints behind the NEXT cold launch. A rejection escaping here
 * would surface as an unhandled rejection during a theme toggle — a visible fault
 * in exchange for a splash colour.
 */
describe("persistNativeThemePreference — when the bridge cannot answer", () => {
  it("swallows a plugin call that rejects", async () => {
    forceNative(true)
    vi.mocked(Preferences.set).mockRejectedValueOnce(
      new Error("bridge unavailable"),
    )
    await expect(
      persistNativeThemePreference("light"),
    ).resolves.toBeUndefined()
  })

  //An OTA bundle can be running on a binary built before the plugin was added
  //(→ `docs/design/ota.md §5.6`), so the dynamic import itself is the thing that
  //fails — earlier than any call, and not something a `try` around `set` covers.
  it("swallows a plugin that is not in the binary at all", async () => {
    forceNative(true)
    vi.resetModules()
    vi.doMock("@capacitor/preferences", () => {
      throw new Error("Cannot find module '@capacitor/preferences'")
    })
    try {
      const fresh = await import("#adaptv/capabilities/native-theme")
      await expect(
        fresh.persistNativeThemePreference("dark"),
      ).resolves.toBeUndefined()
    } finally {
      vi.doUnmock("@capacitor/preferences")
      vi.resetModules()
    }
  })
})

/*
 * The key is declared TWICE, in three languages, and the two declarations cannot
 * share a module: this file writes it from the WebView, and `bin/lib/native.mjs`
 * bakes it into `MainActivity.java` (Android, bare key inside the
 * `CapacitorStorage` SharedPreferences file) and `AppDelegate.swift` (iOS, where
 * Capacitor namespaces UserDefaults keys, so the same key is read as
 * `CapacitorStorage.<key>`).
 *
 * Drift is silent by construction. The native side reads a key that is simply
 * absent, `?? "system"` fires, and the app launches following the system
 * appearance instead of its own theme — no error, no log, and nothing to notice
 * until someone runs a dark app on a light phone. `docs/decisions/register.md`
 * records this failing once already, from the other end (the plugin missing, so
 * the value never reached SharedPreferences at all).
 *
 * Same seam, same reason as `src/shell/offline-page-name.test.ts`.
 */
describe("the launch key", () => {
  const NATIVE_GENERATOR = "bin/lib/native.mjs"
  const generator = readFileSync(
    path.join(process.cwd(), NATIVE_GENERATOR),
    "utf8",
  )

  it("is the key Android's MainActivity reads", () => {
    //the walk this rests on: the generator is the file that writes the launch code
    expect(generator).toContain("MainActivity")
    expect(generator).toContain(`"${NATIVE_THEME_PREF_KEY}"`)
  })

  it("is the key iOS's AppDelegate reads, under Capacitor's UserDefaults prefix", () => {
    expect(generator).toContain("AppDelegate")
    expect(generator).toContain(
      `"CapacitorStorage.${NATIVE_THEME_PREF_KEY}"`,
    )
  })
})
