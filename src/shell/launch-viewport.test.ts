import { afterEach, describe, expect, it, vi } from "vitest"
import { SPLASH_REVEALED_ATTR } from "#adaptv/hooks/use-splash-handoff"
import { getLaunchViewportInitScript } from "#adaptv/shell/launch-viewport"

//The script is a string that runs pre-paint, so it is run in the happy-dom document. happy-dom
//lays nothing out, so each probe's style is read as the script wrote it and answered from a
//reading taken on a simulator AT THAT MOMENT: every measure separately, because they do not
//move together (at iOS 26.1's resize `innerHeight` is already 812 while `100dvh` is still 874).
type Reading = { vh: number; dvh: number; ih: number; insetTop: number }

const root = document.documentElement
const innerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight")
let reading: Reading

function probeHeight(style: string): number {
  if (/height:\s*100vh/.test(style)) return reading.vh
  if (/height:\s*100dvh/.test(style)) return reading.dvh
  if (
    /height:\s*calc\(100dvh \+ var\(--adaptv-inset-top, 0px\)\)/.test(
      style,
    )
  )
    return reading.dvh + reading.insetTop
  if (/height:\s*var\(--adaptv-inset-top, 0px\)/.test(style))
    return reading.insetTop
  throw new Error(`unmodelled probe: ${style}`)
}

//"ios" is an app on the home screen (iOS sets navigator.standalone), "android" an installed app
//that only matches the standalone display mode, "tab" a browser tab.
function launch(at: Reading, where: "ios" | "android" | "tab" = "ios") {
  reading = at
  root.style.removeProperty("--pwa-launch-height")
  root.removeAttribute(SPLASH_REVEALED_ATTR)
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: where !== "tab" && query === "(display-mode: standalone)",
  }))
  Object.defineProperty(window.navigator, "standalone", {
    configurable: true,
    value: where === "ios" ? true : undefined,
  })
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    get: () => reading.ih,
  })
  const written = new WeakMap<CSSStyleDeclaration, string>()
  const cssText = Object.getOwnPropertyDescriptor(
    CSSStyleDeclaration.prototype,
    "cssText",
  )
  vi.spyOn(
    CSSStyleDeclaration.prototype,
    "cssText",
    "set",
  ).mockImplementation(function (
    this: CSSStyleDeclaration,
    value: string,
  ) {
    written.set(this, value)
    cssText?.set?.call(this, value)
  })
  vi.spyOn(
    HTMLElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(function (this: HTMLElement) {
    return {
      height: probeHeight(written.get(this.style) ?? ""),
    } as DOMRect
  })
  new Function(getLaunchViewportInitScript())()
}

function resize(at: Reading) {
  reading = at
  window.dispatchEvent(new Event("resize"))
}

const launchHeight = () =>
  root.style.getPropertyValue("--pwa-launch-height")

afterEach(() => {
  //a revealed splash detaches the script's resize listener, so no launch leaks into the next
  root.setAttribute(SPLASH_REVEALED_ATTR, "")
  window.dispatchEvent(new Event("resize"))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (innerHeight)
    Object.defineProperty(window, "innerHeight", innerHeight)
  Reflect.deleteProperty(window.navigator, "standalone")
})

describe("the launch height the splash centres in", () => {
  it("follows an iOS 26 installed app's web view down to the screen it shows", () => {
    //iOS 26.1 (23B86), every launch that froze 874: the head reads the whole 874pt screen,
    //then the window `resize` reads innerHeight 812 with 100vh AND 100dvh still 874. Frozen
    //at 874, the splash centred 31pt below the middle of what is on screen.
    launch({ vh: 874, dvh: 874, ih: 874, insetTop: 0 })
    expect(launchHeight()).toBe("874px")
    resize({ vh: 874, dvh: 874, ih: 812, insetTop: 0 })
    expect(launchHeight()).toBe("812px")
    //lowered, never raised: a later, smaller shrink does not bring back what the first took
    resize({ vh: 874, dvh: 812, ih: 850, insetTop: 0 })
    expect(launchHeight()).toBe("812px")
  })

  it("keeps an iOS 18 cold start's height when the viewport grows, which is the shift it holds off", () => {
    //iOS 18.0 (22A3351), a static test page installed to the home screen (the adaptv page there
    //read innerHeight 852): 793 everywhere at head; at the resize 100vh is 852 while innerHeight
    //and 100dvh stay 793 under a 59pt inset, so the page shows 852.
    launch({ vh: 793, dvh: 793, ih: 793, insetTop: 0 })
    resize({ vh: 852, dvh: 793, ih: 793, insetTop: 59 })
    expect(launchHeight()).toBe("793px")
  })

  it("keeps an iOS 18 cold start's height when the inset has not resolved at the resize", () => {
    launch({ vh: 793, dvh: 793, ih: 793, insetTop: 0 })
    resize({ vh: 852, dvh: 793, ih: 793, insetTop: 0 })
    expect(launchHeight()).toBe("793px")
  })

  it("keeps the whole screen of an iOS 18 app whose innerHeight reads short under the status bar", () => {
    //the same static 18.0 page 3s in: innerHeight 793 under the 59pt inset, 100vh 852. A launch
    //that froze the whole screen (as the adaptv page's 852 would) must not read that as a shrink.
    launch({ vh: 852, dvh: 793, ih: 793, insetTop: 59 })
    resize({ vh: 852, dvh: 793, ih: 793, insetTop: 59 })
    expect(launchHeight()).toBe("852px")
  })

  it("keeps a launch that already read the shown screen", () => {
    //iOS 26.1, first launch after a boot: the view had shrunk before the head script ran.
    launch({ vh: 812, dvh: 812, ih: 812, insetTop: 0 })
    resize({ vh: 874, dvh: 812, ih: 812, insetTop: 0 })
    expect(launchHeight()).toBe("812px")
  })

  it("stops following once the splash is revealed, for good", () => {
    launch({ vh: 874, dvh: 874, ih: 874, insetTop: 0 })
    root.setAttribute(SPLASH_REVEALED_ATTR, "")
    resize({ vh: 874, dvh: 874, ih: 812, insetTop: 0 })
    expect(launchHeight()).toBe("874px")
    //the listener is gone: even with the attribute cleared, a shrink changes nothing
    root.removeAttribute(SPLASH_REVEALED_ATTR)
    resize({ vh: 874, dvh: 600, ih: 600, insetTop: 0 })
    expect(launchHeight()).toBe("874px")
  })

  it("ignores a resize that reads no height", () => {
    launch({ vh: 874, dvh: 874, ih: 874, insetTop: 0 })
    resize({ vh: 874, dvh: 874, ih: 0, insetTop: 0 })
    expect(launchHeight()).toBe("874px")
  })

  it("keeps an Android installed app's frozen height when its view reads short", () => {
    //illustrative readings, not measured: an installed app on Android (standalone display mode,
    //no navigator.standalone) reloading with the keyboard still up reads innerHeight short of the
    //screen, at head and at the resize that follows. Nothing like iOS 26's shrink was measured there.
    launch({ vh: 915, dvh: 600, ih: 600, insetTop: 0 }, "android")
    expect(launchHeight()).toBe("915px")
    resize({ vh: 915, dvh: 560, ih: 560, insetTop: 0 })
    expect(launchHeight()).toBe("915px")
  })

  it("leaves a browser tab unset", () => {
    launch({ vh: 754, dvh: 714, ih: 714, insetTop: 0 }, "tab")
    resize({ vh: 754, dvh: 600, ih: 600, insetTop: 0 })
    expect(launchHeight()).toBe("")
  })

  it("waits on the attribute the splash handoff writes", () => {
    expect(getLaunchViewportInitScript()).toContain(
      `hasAttribute('${SPLASH_REVEALED_ATTR}')`,
    )
  })
})
