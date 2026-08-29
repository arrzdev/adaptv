import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getChromeTint,
  setThemeColorBase,
} from "#adaptv/capabilities/theme-color"
import {
  clearDrawerChromeTint,
  setDrawerChromeTint,
  transitionDrawerChromeTint,
} from "#adaptv/components/drawer/drawer-chrome-tint"
import { DEFAULT_DRAWER_TRANSITION } from "#adaptv/components/drawer/drawer-constants"
import { THEME_COLOR_META_ID } from "#adaptv/shell/theme-init-script"

const LIGHT = "#eeeeec"
/** `#eeeeec` under `rgba(0, 0, 0, 0.4)` — 238 × 0.6 = 142.8 → `0x8f` */
const DIMMED = "#8f8f8e"

const INSTANT = { ...DEFAULT_DRAWER_TRANSITION, duration: 0 }

function seedMeta() {
  const meta = document.createElement("meta")
  meta.id = THEME_COLOR_META_ID
  meta.name = "theme-color"
  meta.content = LIGHT
  document.head.appendChild(meta)
  return meta
}

function backdropWith(background: string) {
  const el = document.createElement("button")
  document.body.appendChild(el)
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    backgroundColor: background,
  } as unknown as CSSStyleDeclaration)
  return el
}

beforeEach(() => {
  setThemeColorBase(null)
  document.getElementById(THEME_COLOR_META_ID)?.remove()
  document.body.innerHTML = ""
})

afterEach(() => {
  vi.restoreAllMocks()
  document.getElementById(THEME_COLOR_META_ID)?.remove()
})

describe("transitionDrawerChromeTint", () => {
  it("dims the chrome by the scrim the consumer actually rendered", () => {
    seedMeta()
    setThemeColorBase(LIGHT)
    transitionDrawerChromeTint(
      backdropWith("rgba(0, 0, 0, 0.4)"),
      1,
      INSTANT,
      0,
    )
    expect(getChromeTint()).toBe(DIMMED)
  })

  it("composites a coloured scrim rather than assuming black", () => {
    seedMeta()
    setThemeColorBase("#000000")
    transitionDrawerChromeTint(
      //a light scrim over a dark theme LIGHTENS the toolbar; anything that
      //hardcodes "darken" gets this backwards
      backdropWith("rgba(255, 255, 255, 0.5)"),
      1,
      INSTANT,
      0,
    )
    expect(getChromeTint()).toBe("#808080")
  })

  it("hands the chrome back when the backdrop fades out", () => {
    seedMeta()
    setThemeColorBase(LIGHT)
    const backdrop = backdropWith("rgba(0, 0, 0, 0.4)")
    transitionDrawerChromeTint(backdrop, 1, INSTANT, 0)
    transitionDrawerChromeTint(backdrop, 0, INSTANT, 0)
    expect(getChromeTint()).toBe(LIGHT)
  })

  it("leaves the tint alone when the scrim is transparent", () => {
    seedMeta()
    setThemeColorBase(LIGHT)
    transitionDrawerChromeTint(
      backdropWith("rgba(0, 0, 0, 0)"),
      1,
      INSTANT,
      0,
    )
    expect(getChromeTint()).toBe(LIGHT)
  })

  /**
   * The case that matters most, because it is the DEFAULT one. The drawer's own scrim is
   * `bg-black/40`, Tailwind v4 compiles that to a `color-mix()`, and a running build reports it
   * back from `getComputedStyle` as `oklch(0 0 0 / 0.65)` — measured, not assumed. A tint that
   * only understood `rgb()` would have been a silent no-op on the repo's own drawer.
   */
  it("reads the oklch scrim a real build actually renders", () => {
    seedMeta()
    setThemeColorBase(LIGHT)
    transitionDrawerChromeTint(
      backdropWith("oklch(0 0 0 / 0.65)"),
      1,
      INSTANT,
      0,
    )
    //238 × (1 − 0.65) = 83.3 → 0x53
    expect(getChromeTint()).toBe("#535353")
  })

  it("leaves the tint alone when the scrim cannot be read", () => {
    seedMeta()
    setThemeColorBase(LIGHT)
    transitionDrawerChromeTint(
      backdropWith("color(display-p3 0.2 0 0 / 0.4)"),
      1,
      INSTANT,
      0,
    )
    expect(getChromeTint()).toBe(LIGHT)
  })

  it("does nothing at all when there is no tag", () => {
    //no meta seeded — a theme that never resolved, or a shell without one
    const backdrop = backdropWith("rgba(0, 0, 0, 0.4)")
    expect(() =>
      transitionDrawerChromeTint(backdrop, 1, INSTANT, 0),
    ).not.toThrow()
    expect(getChromeTint()).toBeNull()
  })
})

describe("setDrawerChromeTint", () => {
  it("tracks the drag between the theme colour and the full dim", () => {
    seedMeta()
    setThemeColorBase(LIGHT)
    const backdrop = backdropWith("rgba(0, 0, 0, 0.4)")

    setDrawerChromeTint(backdrop, 1)
    expect(getChromeTint()).toBe(DIMMED)
    setDrawerChromeTint(backdrop, 0)
    expect(getChromeTint()).toBe(LIGHT)
    setDrawerChromeTint(backdrop, 0.5)
    //halfway is the scrim at half its opacity, not a halfway hex
    expect(getChromeTint()).toBe("#bebebd")
  })

  it("reads the scrim once per open, not once per frame", () => {
    seedMeta()
    setThemeColorBase(LIGHT)
    const backdrop = backdropWith("rgba(0, 0, 0, 0.4)")
    const computed = vi.mocked(window.getComputedStyle)

    transitionDrawerChromeTint(backdrop, 1, INSTANT, 0)
    const afterOpen = computed.mock.calls.length
    for (let i = 0; i <= 10; i++) setDrawerChromeTint(backdrop, i / 10)

    //a forced style recalc per drag frame is exactly what the sheet cannot afford
    expect(computed.mock.calls.length).toBe(afterOpen)
  })
})

describe("clearDrawerChromeTint", () => {
  it("puts the chrome back with nothing animating", () => {
    seedMeta()
    setThemeColorBase(LIGHT)
    const backdrop = backdropWith("rgba(0, 0, 0, 0.4)")
    setDrawerChromeTint(backdrop, 1)
    clearDrawerChromeTint()
    expect(getChromeTint()).toBe(LIGHT)
  })
})
