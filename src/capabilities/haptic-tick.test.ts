import { afterEach, describe, expect, it, vi } from "vitest"
import {
  attachHapticTick,
  HAPTIC_TICK_ATTR,
  supportsHapticTick,
} from "#adaptv/capabilities/haptic-tick"

const restores: Array<() => void> = []

function stubNavigatorProp(key: string, value: unknown): void {
  const prev = Object.getOwnPropertyDescriptor(navigator, key)
  Object.defineProperty(navigator, key, { value, configurable: true })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, key, prev)
    else delete (navigator as unknown as Record<string, unknown>)[key]
  })
}

/** Put the runtime in the one configuration where the switch trick is the only option. */
function forceIOSWeb(): void {
  vi.stubGlobal("Capacitor", undefined)
  stubNavigatorProp(
    "userAgent",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5)",
  )
  stubNavigatorProp("vibrate", undefined)
}

function host(tag = "div"): HTMLElement {
  const el = document.createElement(tag)
  document.body.appendChild(el)
  restores.push(() => el.remove())
  return el
}

function overlayIn(el: HTMLElement): HTMLInputElement | null {
  return el.querySelector(`[${HAPTIC_TICK_ATTR}]`)
}

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
})

describe("supportsHapticTick — only where nothing else can work", () => {
  //The switch overlay is a last resort: it costs a real DOM node in every tap
  //target and can only ever produce the system tick (no weights, no patterns).
  //It must therefore be OFF anywhere a better mechanism exists.
  it("is true on iOS web, which has no other haptic path at all", () => {
    forceIOSWeb()
    expect(supportsHapticTick()).toBe(true)
  })

  it("is false when navigator.vibrate exists — the imperative path is better", () => {
    forceIOSWeb()
    stubNavigatorProp("vibrate", () => true)
    expect(supportsHapticTick()).toBe(false)
  })

  it("is false on native — the real engine is right there", () => {
    forceIOSWeb()
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true })
    expect(supportsHapticTick()).toBe(false)
  })

  it("is false off-iOS — the trick is a WebKit quirk, not a web feature", () => {
    vi.stubGlobal("Capacitor", undefined)
    stubNavigatorProp("userAgent", "Mozilla/5.0 (Linux; Android 15)")
    stubNavigatorProp("vibrate", undefined)
    expect(supportsHapticTick()).toBe(false)
  })
})

describe("attachHapticTick — the overlay", () => {
  it("injects a real <input switch>, because that is the whole mechanism", () => {
    //iOS 26.5 patched programmatic .click() on this element, so the ONLY surviving
    //technique is to put a genuine switch under the user's actual finger.
    forceIOSWeb()
    const el = host()
    attachHapticTick(el)

    const overlay = overlayIn(el)
    expect(overlay).not.toBeNull()
    expect(overlay?.tagName).toBe("INPUT")
    expect(overlay?.getAttribute("type")).toBe("checkbox")
    expect(overlay?.hasAttribute("switch")).toBe(true)
  })

  it("hides the overlay from assistive tech and the tab order", () => {
    //it is a haptic transducer, not a control — AT announcing "switch, off" on
    //every button would be a serious regression
    forceIOSWeb()
    const el = host()
    attachHapticTick(el)

    const overlay = overlayIn(el)
    expect(overlay?.getAttribute("aria-hidden")).toBe("true")
    expect(overlay?.getAttribute("tabindex")).toBe("-1")
  })

  it("covers the host so the finger cannot miss it", () => {
    forceIOSWeb()
    const el = host()
    attachHapticTick(el)

    const style = overlayIn(el)?.style
    expect(style?.position).toBe("absolute")
    expect(style?.opacity).toBe("0")
    expect(style?.width).toBe("100%")
    expect(style?.height).toBe("100%")
  })

  it("lets the tap through to the host — the overlay must not swallow clicks", () => {
    //the overlay is a CHILD, so the click bubbles to the host and the host's own
    //handler still runs. If this ever breaks, every haptic button stops working.
    forceIOSWeb()
    const el = host()
    attachHapticTick(el)

    const onClick = vi.fn()
    el.addEventListener("click", onClick)
    overlayIn(el)?.click()

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("gives the host a containing block only when it lacks one", () => {
    forceIOSWeb()
    const el = host()
    attachHapticTick(el)
    expect(el.style.position).toBe("relative")
  })

  it("does not clobber a host that already positions itself", () => {
    forceIOSWeb()
    const el = host()
    el.style.position = "absolute"
    attachHapticTick(el)
    expect(el.style.position).toBe("absolute")
  })
})

describe("attachHapticTick — lifecycle", () => {
  it("returns a detach that removes the overlay and restores the host", () => {
    forceIOSWeb()
    const el = host()
    const detach = attachHapticTick(el)
    expect(overlayIn(el)).not.toBeNull()

    detach()
    expect(overlayIn(el)).toBeNull()
    expect(el.style.position).toBe("")
  })

  it("is idempotent — re-attaching never stacks overlays", () => {
    forceIOSWeb()
    const el = host()
    attachHapticTick(el)
    attachHapticTick(el)
    expect(el.querySelectorAll(`[${HAPTIC_TICK_ATTR}]`)).toHaveLength(1)
  })

  it("is a safe no-op where unsupported, so callers never branch", () => {
    //this is the point of the API: a consumer attaches unconditionally and pays
    //nothing on the platforms that have a real haptic engine
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true })
    const el = host()
    const detach = attachHapticTick(el)

    expect(overlayIn(el)).toBeNull()
    expect(el.style.position).toBe("")
    expect(() => detach()).not.toThrow()
  })
})
