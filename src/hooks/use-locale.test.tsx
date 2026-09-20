import { act, renderHook } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resetLocale, resolveLocale } from "#adaptv/capabilities/locale"
import { useLocale } from "#adaptv/hooks/use-locale"

/*
 * Against the real capability, not a mock: what the hook owes is a re-render
 * on a real `languagechange` and a stable object between them, and a mocked
 * store would prove only that `useSyncExternalStore` works.
 */

const restores: Array<() => void> = []

function stubNavigatorProp(key: string, value: unknown): void {
  const prev = Object.getOwnPropertyDescriptor(navigator, key)
  Object.defineProperty(navigator, key, { value, configurable: true })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, key, prev)
    else delete (navigator as unknown as Record<string, unknown>)[key]
  })
}

function setLanguage(tag: string, preferred: string[]): void {
  stubNavigatorProp("language", tag)
  stubNavigatorProp("languages", preferred)
}

afterEach(() => {
  for (const r of restores.splice(0)) r()
  resetLocale()
})

function LocaleLine() {
  const { languageTag, region, hourCycle } = useLocale()
  return <p>{`${languageTag}|${region ?? "none"}|${hourCycle}`}</p>
}

describe("useLocale", () => {
  it("renders the current record", () => {
    setLanguage("pt-PT", ["pt-PT", "en-US"])
    const { result } = renderHook(() => useLocale())
    expect(result.current).toMatchObject({
      languageTag: "pt-PT",
      hourCycle: "h23",
      decimalSeparator: ",",
      preferred: ["pt-PT", "en-US"],
    })
  })

  it("re-renders with the new record on languagechange", () => {
    setLanguage("en-US", ["en-US"])
    const { result } = renderHook(() => useLocale())
    const before = result.current
    expect(before.direction).toBe("ltr")

    setLanguage("ar-EG", ["ar-EG", "en-US"])
    act(() => {
      window.dispatchEvent(new Event("languagechange"))
    })

    expect(result.current).not.toBe(before)
    expect(result.current).toMatchObject({
      languageTag: "ar-EG",
      direction: "rtl",
      firstWeekday: 6,
    })
  })

  it("keeps the same object across a re-render when nothing changed", () => {
    setLanguage("pt-PT", ["pt-PT"])
    const { result, rerender } = renderHook(() => useLocale())
    const before = result.current
    rerender()
    act(() => {
      window.dispatchEvent(new Event("languagechange"))
    })
    expect(result.current).toBe(before)
  })

  it("serves the en record on the server", () => {
    //`renderToString` takes the server snapshot, whatever the navigator says —
    //the server has no user, so the bare fallback is the honest render
    setLanguage("pt-PT", ["pt-PT"])
    const en = resolveLocale("en")
    expect(renderToString(<LocaleLine />)).toContain(
      `${en.languageTag}|none|${en.hourCycle}`,
    )
    expect(renderToString(<LocaleLine />)).not.toContain("pt-PT")
  })

  it("serves a server snapshot whose zone does not depend on the runtime's", async () => {
    //the module is evaluated once on the server and once in the browser; a zone
    //read from either runtime makes the two snapshots disagree, and hydration
    //throws the server tree away (measured: a server in Europe/Lisbon and a
    //browser in Pacific/Kiritimati, React's text-mismatch error on /lab/locale)
    const original = Intl.DateTimeFormat.prototype.resolvedOptions
    Intl.DateTimeFormat.prototype.resolvedOptions = function (
      this: Intl.DateTimeFormat,
    ) {
      return { ...original.call(this), timeZone: "Pacific/Kiritimati" }
    }
    restores.push(() => {
      Intl.DateTimeFormat.prototype.resolvedOptions = original
    })
    vi.resetModules()
    //the hook module and the renderer re-imported together, so both share the
    //fresh React the reset hands out
    const fresh = await import("#adaptv/hooks/use-locale")
    const server = await import("react-dom/server")
    function ZoneLine() {
      return <p>{fresh.useLocale().timeZone}</p>
    }
    expect(server.renderToString(<ZoneLine />)).toContain("UTC")
  })
})
