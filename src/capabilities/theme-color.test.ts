import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getChromeTint,
  getChromeTintBase,
  restoreChromeTint,
  setChromeTint,
  setThemeColorBase,
  transitionChromeTint,
} from "#adaptv/capabilities/theme-color"
import { THEME_COLOR_META_ID } from "#adaptv/shell/theme-init-script"

const LIGHT = "#eeeeec"
//`#eeeeec` under a 40% black scrim
const DIMMED = "#8f8f8e"

/** Drive the rAF loop by hand: every frame lands where the test says it does. */
function installClock() {
  let now = 0
  const pending = new Map<number, FrameRequestCallback>()
  let nextId = 1

  vi.stubGlobal("performance", { now: () => now })
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pending.delete(id)
  })

  return {
    /** Advance `ms` and run whatever frame was queued. */
    tick(ms: number) {
      now += ms
      const [entry] = [...pending.entries()]
      if (!entry) return
      pending.delete(entry[0])
      entry[1](now)
    },
    get frames() {
      return pending.size
    },
  }
}

/** The red channel of a `#rrggbb`, for asserting a direction of travel. */
function channel(hex: string) {
  return Number.parseInt(hex.slice(1, 3), 16)
}

function seedMeta(content = LIGHT) {
  const meta = document.createElement("meta")
  meta.id = THEME_COLOR_META_ID
  meta.name = "theme-color"
  meta.content = content
  document.head.appendChild(meta)
  return meta
}

let clock: ReturnType<typeof installClock>

beforeEach(() => {
  //module state outlives a test inside one file; the base is global by design
  setThemeColorBase(null)
  document.getElementById(THEME_COLOR_META_ID)?.remove()
  clock = installClock()
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.getElementById(THEME_COLOR_META_ID)?.remove()
  for (const restore of restores.splice(0)) restore()
})

const UA_IOS_26 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1"
const UA_IOS_18 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36"

const restores: Array<() => void> = []

function stubNavigator(props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props)) {
    const prev = Object.getOwnPropertyDescriptor(navigator, key)
    Object.defineProperty(navigator, key, { value, configurable: true })
    restores.push(() => {
      if (prev) Object.defineProperty(navigator, key, prev)
      else delete (navigator as unknown as Record<string, unknown>)[key]
    })
  }
}

/** A Safari tab on the given OS: no Capacitor global, `display-mode` not standalone. */
function stubBrowserTab(userAgent: string) {
  stubNavigator({ userAgent, platform: "iPhone", maxTouchPoints: 5 })
}

function stubStandalone() {
  window.matchMedia = ((query: string) => ({
    matches: query === "(display-mode: standalone)",
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia
}

/** The strip is found by its attribute — the module keeps the name private. */
const BAND_DONOR = "[data-adaptv-band-donor]"

function donor(): HTMLElement | null {
  return document.body.querySelector(BAND_DONOR)
}

function donors(): number {
  return document.body.querySelectorAll(BAND_DONOR).length
}

describe("getChromeTint / setChromeTint", () => {
  it("reads and writes the one meta adaptv owns", () => {
    seedMeta()
    expect(getChromeTint()).toBe(LIGHT)
    setChromeTint("#101012")
    expect(getChromeTint()).toBe("#101012")
  })

  it("reports null rather than inventing a colour when there is no tag", () => {
    expect(getChromeTint()).toBeNull()
  })
})

describe("transitionChromeTint", () => {
  it("walks the tint along the curve instead of snapping", () => {
    const meta = seedMeta()
    transitionChromeTint(DIMMED, {
      duration: 0.4,
      easing: [0.32, 0.72, 0, 1],
    })

    //the first painted frame is already HALF A FRAME into the curve rather than
    //sitting on the base: the lead that cancels the browser-process paint hop.
    //8.3ms of a 400ms curve is a small step off `#eeeeec`, not a jump.
    clock.tick(0)
    expect(meta.content).toBe("#e9e9e7")

    //the open curve is front-loaded: a quarter of the DURATION is well past
    //half the TRAVEL, which is the whole reason the curve is passed through
    clock.tick(100)
    const quarter = meta.content
    expect(quarter).not.toBe(LIGHT)
    expect(quarter).not.toBe(DIMMED)
    expect(Number.parseInt(quarter.slice(1, 3), 16)).toBeLessThan(
      (0xee + 0x8f) / 2,
    )
  })

  /*
   * The lead is the whole reason the tint reads as part of the drawer's motion
   * rather than as a second thing chasing it: page pixels are composited by the
   * renderer, the toolbar is painted by the browser process an IPC hop later.
   * These pin that it exists, that it tracks the screen's real cadence, and that
   * a stalled frame cannot turn it into a jump.
   */
  it("leads by the interval it measures, not a hardcoded 60Hz", async () => {
    const meta = seedMeta()

    //a 120Hz screen: four more frames at 8ms, so now = 32 with an 8ms lead
    const fast = transitionChromeTint(DIMMED, { duration: 0.4 })
    clock.tick(0)
    for (let i = 0; i < 4; i += 1) clock.tick(8)
    const at120 = channel(meta.content)

    //the same 32ms of wall clock in one long frame, so the lead is 32ms
    meta.content = LIGHT
    transitionChromeTint(DIMMED, { duration: 0.4 })
    await fast.finished
    clock.tick(0)
    clock.tick(32)
    const at30 = channel(meta.content)

    //further along, and only because the lead is bigger — same curve, same clock
    expect(at30).toBeLessThan(at120)
  })

  it("treats a stalled frame as a stall, not as a 6Hz screen", async () => {
    const meta = seedMeta()

    const stalled = transitionChromeTint(DIMMED, { duration: 0.4 })
    clock.tick(0)
    //a dropped frame — nearly half the curve's duration with nothing painted
    clock.tick(160)
    const afterStall = channel(meta.content)

    meta.content = LIGHT
    transitionChromeTint(DIMMED, { duration: 0.4 })
    await stalled.finished
    clock.tick(0)
    //the same elapsed time, arrived at without stalling
    clock.tick(160)
    const smooth = channel(meta.content)

    //the lead is capped, so the stall costs at most one extra frame of travel
    //instead of throwing the tint 160ms ahead of the page
    expect(Math.abs(afterStall - smooth)).toBeLessThan(6)
  })

  it("lands exactly on the target and stops asking for frames", async () => {
    const meta = seedMeta()
    const transition = transitionChromeTint(DIMMED, { duration: 0.4 })

    clock.tick(0)
    clock.tick(400)

    await transition.finished
    expect(meta.content).toBe(DIMMED)
    expect(clock.frames).toBe(0)
  })

  it("takes over from the colour on screen when interrupted", async () => {
    const meta = seedMeta()
    const opening = transitionChromeTint(DIMMED, { duration: 0.4 })
    clock.tick(0)
    clock.tick(120)
    const interruptedAt = meta.content

    //the drawer being dragged back before it ever finished opening
    const closing = transitionChromeTint(LIGHT, { duration: 0.2 })
    await opening.finished
    clock.tick(0)

    //the reverse starts from where the tint actually got to, NOT from the
    //target it never reached — no jump at the seam. It is not exactly
    //`interruptedAt` because the new curve carries the same one-frame lead, so
    //what to assert is that the seam is a frame wide and points the right way:
    //back towards LIGHT, and nowhere near the gap it would jump if it had
    //restarted from DIMMED.
    const seam = channel(meta.content)
    const from = channel(interruptedAt)
    expect(seam).toBeGreaterThan(from)
    expect(seam - from).toBeLessThan((0xee - from) / 4)

    clock.tick(200)
    await closing.finished
    expect(meta.content).toBe(LIGHT)
  })

  it("jumps under reduced motion", () => {
    const meta = seedMeta()
    window.matchMedia = ((query: string) => ({
      matches: query.includes("reduced-motion"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia

    transitionChromeTint(DIMMED, { duration: 0.4 })
    expect(meta.content).toBe(DIMMED)
    expect(clock.frames).toBe(0)
  })

  it("jumps rather than stalling when a colour cannot be read", () => {
    const meta = seedMeta()
    transitionChromeTint("color(display-p3 0.2 0 0)", { duration: 0.4 })
    //unparseable target: set it verbatim and let the browser have the last word
    expect(meta.content).toBe("color(display-p3 0.2 0 0)")
    expect(clock.frames).toBe(0)
  })

  it("animates to an oklch target, which is what a themed app hands it", () => {
    const meta = seedMeta()
    const transition = transitionChromeTint("oklch(0 0 0)", {
      duration: 0.4,
    })
    clock.tick(0)
    clock.tick(200)
    expect(meta.content).not.toBe(LIGHT)
    clock.tick(200)
    return transition.finished.then(() => {
      expect(meta.content).toBe("#000000")
    })
  })

  it("writes nothing at all when there is no chrome to tint", () => {
    const transition = transitionChromeTint(DIMMED, { duration: 0.4 })
    expect(clock.frames).toBe(0)
    return expect(transition.finished).resolves.toBeUndefined()
  })
})

describe("the base, and giving the tag back", () => {
  it("paints straight through while nothing holds the tint", () => {
    const meta = seedMeta("#000000")
    setThemeColorBase(LIGHT)
    expect(meta.content).toBe(LIGHT)
    expect(getChromeTintBase()).toBe(LIGHT)
  })

  it("stops painting once something takes the tint, but keeps re-aiming", () => {
    const meta = seedMeta()
    setThemeColorBase(LIGHT)
    setChromeTint(DIMMED)

    //the user flips to dark with the sheet still open: the chrome must NOT
    //snap to the dark theme mid-sheet…
    setThemeColorBase("#0a0a0c")
    expect(meta.content).toBe(DIMMED)

    //…and letting go must land on dark, not on the light it opened over
    restoreChromeTint({ duration: 0 })
    expect(meta.content).toBe("#0a0a0c")
  })

  it("restores along a curve, from wherever the tint actually is", async () => {
    const meta = seedMeta()
    setThemeColorBase(LIGHT)
    setChromeTint(DIMMED)

    const restore = restoreChromeTint({ duration: 0.2 })
    //half a frame of lead in, as on the way down
    clock.tick(0)
    expect(meta.content).toBe("#919190")
    clock.tick(100)
    expect(meta.content).not.toBe(DIMMED)
    expect(meta.content).not.toBe(LIGHT)
    clock.tick(100)
    await restore.finished
    expect(meta.content).toBe(LIGHT)
  })

  it("is a no-op when nothing ever took the tint", () => {
    const meta = seedMeta()
    setThemeColorBase(LIGHT)
    restoreChromeTint({ duration: 0.2 })
    expect(meta.content).toBe(LIGHT)
    expect(clock.frames).toBe(0)
  })
})

describe("the band donor (iOS browser tab)", () => {
  it("paints the strip alongside the meta on an iOS browser tab", () => {
    stubBrowserTab(UA_IOS_26)
    seedMeta()
    setThemeColorBase(LIGHT)
    const strip = donor()
    expect(strip).not.toBeNull()
    expect(strip?.style.backgroundColor).toBe(LIGHT)
    expect(strip?.parentElement).toBe(document.body)
    expect(strip?.getAttribute("aria-hidden")).toBe("true")
  })

  it("paints it on what Safari 26 calls iOS 18, because the user agent is frozen there", () => {
    //Safari 26.1 on the iOS 26.1 simulator reports `CPU iPhone OS 18_7`, so a version gate
    //would switch the donor off on the one OS that needs it; iOS 18 gets a harmless strip
    stubBrowserTab(UA_IOS_18)
    seedMeta()
    setThemeColorBase(LIGHT)
    expect(donors()).toBe(1)
  })

  it("creates nothing on Android, which reads the meta", () => {
    stubBrowserTab(UA_ANDROID)
    seedMeta()
    setThemeColorBase(LIGHT)
    setChromeTint(DIMMED)
    expect(donors()).toBe(0)
  })

  it("creates nothing on a desktop browser", () => {
    seedMeta()
    setThemeColorBase(LIGHT)
    setChromeTint(DIMMED)
    expect(donors()).toBe(0)
  })

  it("creates nothing in an installed web app, which has no band", () => {
    stubBrowserTab(UA_IOS_26)
    stubStandalone()
    seedMeta()
    setThemeColorBase(LIGHT)
    expect(donors()).toBe(0)
  })

  it("creates nothing in a Capacitor shell, which has no band", () => {
    stubBrowserTab(UA_IOS_26)
    vi.stubGlobal("Capacitor", {
      isNativePlatform: () => true,
      getPlatform: () => "ios",
    })
    seedMeta()
    setThemeColorBase(LIGHT)
    expect(donors()).toBe(0)
  })

  it("is shaped to WebKit's thresholds: fixed, full width, over 10px, over 0.1 opacity, untouchable", () => {
    stubBrowserTab(UA_IOS_26)
    seedMeta()
    setThemeColorBase(LIGHT)
    const style = donor()?.style
    expect(style?.position).toBe("fixed")
    expect(style?.top).toBe("0px")
    expect(style?.left).toBe("0px")
    expect(style?.right).toBe("0px")
    expect(Number.parseFloat(style?.height ?? "0")).toBeGreaterThan(10)
    expect(Number.parseFloat(style?.opacity ?? "0")).toBeGreaterThan(0.1)
    //12% of the chrome colour over 12px: invisible, but not "nearly transparent" to WebKit
    expect(Number.parseFloat(style?.opacity ?? "1")).toBeLessThan(0.2)
    expect(style?.pointerEvents).toBe("none")
    expect(Number(style?.zIndex)).toBe(2147483647)
  })

  it("follows every frame of a transition, so the band never latches", async () => {
    stubBrowserTab(UA_IOS_26)
    const meta = seedMeta()
    setThemeColorBase(LIGHT)
    const strip = donor()
    const seen = new Set<string>()
    const transition = transitionChromeTint(DIMMED, { duration: 0.4 })
    for (let i = 0; i < 30; i++) {
      clock.tick(16)
      expect(strip?.style.backgroundColor).toBe(meta.content)
      seen.add(meta.content)
    }
    await transition.finished
    expect(seen.size).toBeGreaterThan(5)
    expect(strip?.style.backgroundColor).toBe(DIMMED)
  })

  it("follows a gesture write and the restore", () => {
    stubBrowserTab(UA_IOS_26)
    seedMeta()
    setThemeColorBase(LIGHT)
    setChromeTint(DIMMED)
    expect(donor()?.style.backgroundColor).toBe(DIMMED)
    restoreChromeTint({ duration: 0 })
    expect(donor()?.style.backgroundColor).toBe(LIGHT)
  })

  it("keeps re-aiming under an override, like the meta", () => {
    stubBrowserTab(UA_IOS_26)
    seedMeta()
    setThemeColorBase(LIGHT)
    setChromeTint(DIMMED)
    setThemeColorBase("#0a0a0c")
    expect(donor()?.style.backgroundColor).toBe(DIMMED)
    restoreChromeTint({ duration: 0 })
    expect(donor()?.style.backgroundColor).toBe("#0a0a0c")
  })

  it("leaves with the tag, and comes back as one element, never two", () => {
    stubBrowserTab(UA_IOS_26)
    seedMeta()
    setThemeColorBase(LIGHT)
    expect(donors()).toBe(1)
    setThemeColorBase(null)
    expect(donors()).toBe(0)
    setThemeColorBase(LIGHT)
    setThemeColorBase("#0a0a0c")
    setChromeTint(DIMMED)
    expect(donors()).toBe(1)
  })
})
