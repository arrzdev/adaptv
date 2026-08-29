import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { useSyncTheme } from "#adaptv/hooks/use-sync-theme"

const LIGHT = "#eeeeec"
const DARK = "#0a0a0c"

afterEach(() => {
  document.documentElement.className = ""
  document.documentElement.removeAttribute("style")
  document.body.removeAttribute("style")
  document.getElementById("theme-color-class-override")?.remove()
})

function mount(enabled = true, chromeTint: string | null = null) {
  return renderHook(
    (props: { chromeTint: string | null }) =>
      useSyncTheme({
        themeColorLight: LIGHT,
        themeColorDark: DARK,
        chromeTint: props.chromeTint,
        enabled,
      }),
    { initialProps: { chromeTint } },
  )
}

function themeColorMeta(): HTMLMetaElement | null {
  return document.getElementById(
    "theme-color-class-override",
  ) as HTMLMetaElement | null
}

describe("useSyncTheme — the html/body paint is the load-bearing mechanism", () => {
  //B17: `<meta name="theme-color">` went INERT on iOS 26.0–26.5 — caniuse marks it
  //"supported, but does not actually use the color anywhere", and a WebKit engineer
  //confirmed Safari now derives the top-bar tint from the rendered html/body
  //background near the viewport edge instead.
  //@see https://bugs.webkit.org/show_bug.cgi?id=301756
  //
  //So on iOS 26+ the background paint below is not merely anti-flash — it IS the
  //status-bar tint. These tests exist because the paint looks redundant next to the
  //meta tag and is exactly the kind of thing a later cleanup deletes.
  it("paints html AND body regardless of theme-color support", () => {
    document.documentElement.classList.add("dark")
    mount()
    expect(document.documentElement.style.backgroundColor).toBeTruthy()
    expect(document.body.style.backgroundColor).toBeTruthy()
  })

  it("paints with !important so a stylesheet cannot win the top-edge tint", () => {
    document.documentElement.classList.add("light")
    mount()
    expect(
      document.documentElement.style.getPropertyPriority(
        "background-color",
      ),
    ).toBe("important")
    expect(
      document.body.style.getPropertyPriority("background-color"),
    ).toBe("important")
  })

  it("tracks the resolved theme on both surfaces, not just the meta", async () => {
    document.documentElement.classList.add("light")
    mount()
    const lightPaint = document.documentElement.style.backgroundColor
    expect(themeColorMeta()?.content).toBe(LIGHT)

    document.documentElement.classList.remove("light")
    document.documentElement.classList.add("dark")
    //the hook re-syncs off a MutationObserver on <html class>, and observer
    //callbacks are delivered on a microtask — not synchronously with the mutation
    await Promise.resolve()

    expect(document.documentElement.style.backgroundColor).not.toBe(
      lightPaint,
    )
    expect(themeColorMeta()?.content).toBe(DARK)
  })

  it("clears both the meta and the paint when disabled — no orphan tint", () => {
    document.documentElement.classList.add("dark")
    const { unmount } = mount()
    expect(themeColorMeta()).not.toBeNull()

    unmount()
    expect(themeColorMeta()).toBeNull()
    expect(document.documentElement.style.backgroundColor).toBe("")
    expect(document.body.style.backgroundColor).toBe("")
  })

  it("emits no theme-color and no paint when no theme class is resolved", () => {
    //neither `light` nor `dark` on <html> ⇒ nothing to sync; must not guess
    mount()
    expect(themeColorMeta()).toBeNull()
    expect(document.documentElement.style.backgroundColor).toBe("")
  })
})

describe("useSyncTheme — a route's own chromeTint", () => {
  const ROUTE = "#0b6e4f"

  it("outranks the theme on BOTH outputs", () => {
    //not one of them: the meta tag is the Android/Chrome and iOS <= 18 path, the
    //html/body paint is the iOS 26+ one. A route tint that moved only the tag
    //would do nothing at all on a current iPhone.
    document.documentElement.classList.add("dark")
    mount(true, ROUTE)
    expect(themeColorMeta()?.content).toBe(ROUTE)
    expect(document.documentElement.style.backgroundColor).toBe(ROUTE)
    expect(document.body.style.backgroundColor).toBe(ROUTE)
  })

  it("does NOT move when the theme flips — one colour, both themes", () => {
    document.documentElement.classList.add("light")
    mount(true, ROUTE)
    document.documentElement.classList.remove("light")
    document.documentElement.classList.add("dark")
    expect(themeColorMeta()?.content).toBe(ROUTE)
  })

  it("hands the chrome back to the THEME when the route stops declaring one", () => {
    //leaving a tinted route falls back to the app's global colours, never to
    //whatever the layout above it wanted
    document.documentElement.classList.add("dark")
    const view = mount(true, ROUTE)
    view.rerender({ chromeTint: null })
    expect(themeColorMeta()?.content).toBe(DARK)
    expect(document.documentElement.style.backgroundColor).toBe(DARK)
  })
})
