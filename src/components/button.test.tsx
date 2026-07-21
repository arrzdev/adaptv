import { render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HAPTIC_TICK_ATTR } from "#nativ/capabilities/haptic-tick"
import { Button, resolveButtonHaptic } from "#nativ/components/button"

describe("resolveButtonHaptic", () => {
  it("maps `true` to a light tap", () => {
    expect(resolveButtonHaptic(true)).toBe("light")
  })

  it("passes an explicit weight through", () => {
    expect(resolveButtonHaptic("medium")).toBe("medium")
    expect(resolveButtonHaptic("heavy")).toBe("heavy")
  })

  it("is null (no haptic) for false / undefined", () => {
    expect(resolveButtonHaptic(false)).toBeNull()
    expect(resolveButtonHaptic(undefined)).toBeNull()
  })
})

const restores: Array<() => void> = []

function stubNavigatorProp(key: string, value: unknown): void {
  const prev = Object.getOwnPropertyDescriptor(navigator, key)
  Object.defineProperty(navigator, key, { value, configurable: true })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, key, prev)
    else delete (navigator as unknown as Record<string, unknown>)[key]
  })
}

function forceIOSWeb(): void {
  vi.stubGlobal("Capacitor", undefined)
  stubNavigatorProp(
    "userAgent",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5)",
  )
  stubNavigatorProp("vibrate", undefined)
}

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
})

describe("Button haptic — the one surface that works on iOS web", () => {
  //`haptics.impact()` cannot fire on iOS web: the only route to the Taptic Engine
  //needs a real finger on a real element, and iOS 26.5 killed the programmatic
  //workaround. `Button haptic=…` was already declarative at the consumer's level,
  //so it can route through the transducer overlay and keep working everywhere.
  //@see docs/DECISIONS.md B10, src/capabilities/haptic-tick.ts
  it("mounts the transducer when a haptic is requested", () => {
    forceIOSWeb()
    const { container } = render(<Button haptic="medium">Save</Button>)
    expect(container.querySelector(`[${HAPTIC_TICK_ATTR}]`)).not.toBeNull()
  })

  it("mounts nothing when no haptic is requested", () => {
    forceIOSWeb()
    const { container } = render(<Button>Save</Button>)
    expect(container.querySelector(`[${HAPTIC_TICK_ATTR}]`)).toBeNull()
  })

  it("mounts nothing on a disabled button — no feedback for a dead control", () => {
    forceIOSWeb()
    const { container } = render(
      <Button haptic disabled>
        Save
      </Button>,
    )
    expect(container.querySelector(`[${HAPTIC_TICK_ATTR}]`)).toBeNull()
  })

  it("still exposes the button through its ref with the overlay attached", () => {
    //the transducer shares the host ref with useImperativeHandle; a naive
    //composition drops one of them
    forceIOSWeb()
    let handle: { focus: () => void } | null = null
    render(
      <Button
        haptic
        ref={(h) => {
          handle = h
        }}
      >
        Save
      </Button>,
    )
    expect(handle).not.toBeNull()
  })
})

describe("Button — structural classes the consumer cannot break (B8)", () => {
  it("keeps `clickable` when a className fights the touch-action", () => {
    //`clickable` carries the `touch-action: pan-x pan-y pinch-zoom` longhand that
    //keeps `pointercancel` alive on iOS (WebKit 240917). A consumer `touch-none`
    //silently strands the gesture state machine — invisible in every browser
    //except the broken one.
    const { container } = render(
      <Button className="touch-none">Go</Button>,
    )
    const root = container.querySelector("button")
    expect(root?.className).toContain("clickable")
    expect(root?.className).not.toContain("touch-none")
  })

  it("keeps a disabled button non-interactive whatever the className says", () => {
    const { container } = render(
      <Button disabled className="clickable">
        Go
      </Button>,
    )
    expect(container.querySelector("button")?.className).toContain(
      "non-clickable",
    )
  })

  it("still lets the consumer restyle the look — locking stays narrow", () => {
    //restyling a button is the entire point; if `locked` swallowed presentation
    //the component would be useless
    const { container } = render(
      <Button className="bg-blue-600 text-white rounded-full">Go</Button>,
    )
    const className = container.querySelector("button")?.className ?? ""
    expect(className).toContain("bg-blue-600")
    expect(className).toContain("rounded-full")
    //and the overridden default surface is gone
    expect(className).not.toContain("bg-gray-50")
  })
})
