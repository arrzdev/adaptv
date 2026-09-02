import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getLocale,
  resetLocale,
  resolveLocale,
  subscribeLocale,
} from "#adaptv/capabilities/locale"

const restores: Array<() => void> = []

function stubNavigatorProp(key: string, value: unknown): void {
  const prev = Object.getOwnPropertyDescriptor(navigator, key)
  Object.defineProperty(navigator, key, { value, configurable: true })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, key, prev)
    else delete (navigator as unknown as Record<string, unknown>)[key]
  })
}

/** Sets `document.visibilityState` and fires the event the app-state accessor listens to. */
function setVisibility(state: DocumentVisibilityState): void {
  const prev = Object.getOwnPropertyDescriptor(document, "visibilityState")
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  })
  restores.push(() => {
    if (prev) Object.defineProperty(document, "visibilityState", prev)
    else
      delete (document as unknown as Record<string, unknown>)
        .visibilityState
  })
  document.dispatchEvent(new Event("visibilitychange"))
}

/**
 * Removes one Intl Locale Info function for the test, the way an engine without
 * it looks. An engine that never had it (Node 22's V8 exposes the older accessor
 * shape, not the functions) is already the case under test, so there is nothing
 * to remove and nothing to restore.
 */
function withoutLocaleInfo(name: string): void {
  const proto = Intl.Locale.prototype as unknown as Record<string, unknown>
  const prev = Object.getOwnPropertyDescriptor(proto, name)
  if (!prev) return
  delete proto[name]
  restores.push(() => {
    Object.defineProperty(proto, name, prev)
  })
}

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
  resetLocale()
})

describe("resolveLocale", () => {
  it("resolves en-US: ltr, a 12-hour clock, a Sunday-first week, ASCII separators", () => {
    expect(resolveLocale("en-US")).toMatchObject({
      languageTag: "en-US",
      language: "en",
      script: null,
      region: "US",
      direction: "ltr",
      hourCycle: "h12",
      firstWeekday: 7,
      weekend: [6, 7],
      decimalSeparator: ".",
      groupingSeparator: ",",
      preferred: ["en-US"],
    })
  })

  it("resolves pt-PT: a 24-hour clock, a comma decimal and a space grouping", () => {
    const info = resolveLocale("pt-PT")
    expect(info.hourCycle).toBe("h23")
    expect(info.decimalSeparator).toBe(",")
    //ICU has moved between U+00A0 and U+202F for this — either is "a space"
    expect(info.groupingSeparator).toMatch(/^\s$/)
    //CLDR puts Portugal's week on a Sunday start, and node's ICU agrees — pinned
    //to what `new Intl.Locale("pt-PT").getWeekInfo()` reports here, not to a guess
    expect(info.firstWeekday).toBe(7)
    expect(info.weekend).toEqual([6, 7])
  })

  it("resolves de-DE: a Monday-first week", () => {
    const info = resolveLocale("de-DE")
    expect(info.firstWeekday).toBe(1)
    expect(info.weekend).toEqual([6, 7])
    expect(info.hourCycle).toBe("h23")
    expect(info.decimalSeparator).toBe(",")
    expect(info.groupingSeparator).toBe(".")
  })

  it("resolves ar-EG: rtl, a Saturday-first week with a Friday–Saturday weekend", () => {
    expect(resolveLocale("ar-EG")).toMatchObject({
      direction: "rtl",
      firstWeekday: 6,
      weekend: [5, 6],
      region: "EG",
    })
  })

  it("reports a missing region and script as null, and a present one by name", () => {
    expect(resolveLocale("de")).toMatchObject({
      language: "de",
      script: null,
      region: null,
    })
    expect(resolveLocale("zh-Hant-TW")).toMatchObject({
      languageTag: "zh-Hant-TW",
      language: "zh",
      script: "Hant",
      region: "TW",
    })
  })

  it("canonicalises the tag's case", () => {
    expect(resolveLocale("PT-pt").languageTag).toBe("pt-PT")
  })

  it("resolves an unparseable tag as the en record and never throws", () => {
    expect(() => resolveLocale("not a tag !!")).not.toThrow()
    expect(resolveLocale("not a tag !!")).toEqual(resolveLocale("en"))
    expect(resolveLocale("")).toEqual(resolveLocale("en"))
    expect(resolveLocale("en").region).toBeNull()
  })

  it("fills timeZone and calendar from Intl", () => {
    const info = resolveLocale("en-US")
    expect(info.timeZone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
    expect(info.calendar).toBe("gregory")
    //a tag whose default calendar is not Gregorian says so
    expect(resolveLocale("th-TH").calendar).toBe("buddhist")
  })

  it("carries the preference list through, and falls back to the tag alone", () => {
    expect(resolveLocale("pt-PT", ["pt-PT", "en-US"]).preferred).toEqual([
      "pt-PT",
      "en-US",
    ])
    expect(resolveLocale("pt-PT", []).preferred).toEqual(["pt-PT"])
  })

  it("is pure — the same tag gives an equal record every time", () => {
    expect(resolveLocale("ar-EG")).toEqual(resolveLocale("ar-EG"))
  })
})

describe("resolveLocale — an engine without the Intl Locale Info functions", () => {
  it("still knows the direction from the script or language subtag", () => {
    withoutLocaleInfo("getTextInfo")
    expect(resolveLocale("ar-EG").direction).toBe("rtl")
    expect(resolveLocale("he").direction).toBe("rtl")
    expect(resolveLocale("fa-IR").direction).toBe("rtl")
    //a script beats its language: Azerbaijani in Arabic script is rtl,
    //Kurdish in Latin is ltr
    expect(resolveLocale("az-Arab").direction).toBe("rtl")
    expect(resolveLocale("ku-Latn").direction).toBe("ltr")
    expect(resolveLocale("en-US").direction).toBe("ltr")
    expect(resolveLocale("pt-PT").direction).toBe("ltr")
  })

  it("still knows the hour cycle from the date formatter", () => {
    withoutLocaleInfo("getHourCycles")
    expect(resolveLocale("en-US").hourCycle).toBe("h12")
    expect(resolveLocale("pt-PT").hourCycle).toBe("h23")
  })

  it("falls back to the ISO week when there is no week info", () => {
    withoutLocaleInfo("getWeekInfo")
    expect(resolveLocale("en-US")).toMatchObject({
      firstWeekday: 1,
      weekend: [6, 7],
    })
  })
})

describe("getLocale", () => {
  it("follows navigator.language, not the process default locale", () => {
    //The measurement this capability exists for (2026-09-02, Pixel 10 emulator,
    //Android System WebView Chrome/149): after a per-app language change the
    //engine's default locale stayed en-US while navigator.language read pt-PT,
    //so `toLocaleTimeString(undefined, …)` still printed "3:07 PM". Node in CI
    //is the same shape — its default is en-US — so a record that followed the
    //default would say "." and h12 here.
    expect(Intl.DateTimeFormat().resolvedOptions().locale).not.toBe(
      "pt-PT",
    )
    stubNavigatorProp("language", "pt-PT")
    stubNavigatorProp("languages", ["pt-PT", "en-US"])
    const info = getLocale()
    expect(info.languageTag).toBe("pt-PT")
    expect(info.decimalSeparator).toBe(",")
    expect(info.hourCycle).toBe("h23")
    expect(info.preferred).toEqual(["pt-PT", "en-US"])
  })

  it("returns the en record where there is no navigator, and never throws", () => {
    vi.stubGlobal("navigator", undefined)
    expect(() => getLocale()).not.toThrow()
    expect(getLocale()).toEqual(resolveLocale("en"))
  })

  it("returns the same object until the tag or the preferences move", () => {
    stubNavigatorProp("language", "pt-PT")
    stubNavigatorProp("languages", ["pt-PT", "en-US"])
    const first = getLocale()
    expect(getLocale()).toBe(first)

    stubNavigatorProp("languages", ["pt-PT", "en-GB"])
    const second = getLocale()
    expect(second).not.toBe(first)
    expect(second.preferred).toEqual(["pt-PT", "en-GB"])

    stubNavigatorProp("language", "ar-EG")
    expect(getLocale().languageTag).toBe("ar-EG")
  })

  it("falls back to the tag alone when navigator.languages is empty", () => {
    stubNavigatorProp("language", "pt-PT")
    stubNavigatorProp("languages", [])
    expect(getLocale().preferred).toEqual(["pt-PT"])
  })
})

describe("subscribeLocale", () => {
  it("notifies on languagechange when the tag moved, and not after unsubscribe", () => {
    stubNavigatorProp("language", "en-US")
    stubNavigatorProp("languages", ["en-US"])
    const listener = vi.fn()
    const unsubscribe = subscribeLocale(listener)

    stubNavigatorProp("language", "pt-PT")
    stubNavigatorProp("languages", ["pt-PT", "en-US"])
    window.dispatchEvent(new Event("languagechange"))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getLocale().languageTag).toBe("pt-PT")

    unsubscribe()
    stubNavigatorProp("language", "ar-EG")
    window.dispatchEvent(new Event("languagechange"))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("swallows a languagechange that lands on the same tag", () => {
    stubNavigatorProp("language", "pt-PT")
    stubNavigatorProp("languages", ["pt-PT", "en-US"])
    const listener = vi.fn()
    subscribeLocale(listener)

    window.dispatchEvent(new Event("languagechange"))
    expect(listener).not.toHaveBeenCalled()
  })

  it("re-reads when the app returns to the foreground", () => {
    stubNavigatorProp("language", "en-US")
    stubNavigatorProp("languages", ["en-US"])
    const listener = vi.fn()
    subscribeLocale(listener)

    //a background, a change in Settings, a resume — with no languagechange
    //event, which is what Android native does (header)
    setVisibility("hidden")
    stubNavigatorProp("language", "pt-PT")
    stubNavigatorProp("languages", ["pt-PT", "en-US"])
    setVisibility("visible")
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getLocale().languageTag).toBe("pt-PT")

    //…and a resume with nothing new is swallowed too
    setVisibility("hidden")
    setVisibility("visible")
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("is a no-op on the server", () => {
    vi.stubGlobal("window", undefined)
    const listener = vi.fn()
    expect(() => subscribeLocale(listener)()).not.toThrow()
  })
})
