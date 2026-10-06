import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HAPTIC_TICK_ATTR } from "#adaptv/capabilities/haptic-tick"
import { Button, resolveButtonHaptic } from "#adaptv/components/button"

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
  //@see docs/decisions/register.md B10, src/capabilities/haptic-tick.ts
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

describe("Button — structural style the consumer cannot break (B8)", () => {
  it("locks the touch-action inline, against a consumer class and style", () => {
    //the `touch-action: pan-x pan-y pinch-zoom` longhand keeps `pointercancel` alive on
    //iOS (WebKit 240917). A consumer `touch-none` silently strands the gesture state
    //machine — invisible in every browser except the broken one — so the lock is inline
    //style, which no class reaches, and it is written after the consumer's `style`.
    const { container } = render(
      <Button className="touch-none" style={{ touchAction: "none" }}>
        Go
      </Button>,
    )
    const root = container.querySelector("button")
    expect(root?.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    //the class itself reaches the DOM untouched: it simply loses to the inline lock
    expect(root?.className).toBe("touch-none")
  })

  it("keeps a disabled button inert without making it a scroll dead zone", () => {
    /*
     * A disabled control used to carry `touch-none`, which does not govern tappability
     * at all — the engine refuses every gesture when `disabled`, and the native
     * `disabled` attribute blocks activation — but DOES stop the browser reading the
     * gesture as a scroll. Thumb down on a greyed-out button, swipe, page frozen.
     * Measured in `playground/e2e/disabled-scroll.spec.ts`.
     */
    const el = render(
      <Button disabled style={{ userSelect: "text" }}>
        Go
      </Button>,
    ).container.querySelector("button") as HTMLElement
    expect(el.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    expect(el.style.userSelect).toBe("none")
    //inert is carried by the attribute and the engine, which is where it belongs
    expect(el.hasAttribute("disabled")).toBe(true)
  })

  it("still lets the consumer restyle the look — locking stays narrow", () => {
    //restyling a button is the entire point; if the lock swallowed presentation the
    //component would be useless
    const { container } = render(
      <Button
        className="bg-blue-600 text-white rounded-full"
        style={{ color: "rgb(255, 0, 0)" }}
      >
        Go
      </Button>,
    )
    const root = container.querySelector("button")
    //the consumer's className is all there is: the default surface is a layer rule
    expect(root?.className).toBe("bg-blue-600 text-white rounded-full")
    expect(root?.style.color).toBe("rgb(255, 0, 0)")
    //nothing but the interaction longhand is inline
    expect(root?.style.backgroundColor).toBe("")
    expect(root?.style.display).toBe("")
  })
})

describe("Button — parts: attributes, no class of adaptv's", () => {
  function parts(container: HTMLElement) {
    return [...container.querySelectorAll<HTMLElement>("[data-part]")]
  }

  it("names every part it renders and writes no class on any of them", () => {
    const { container } = render(
      <Button>
        <Button.Leading>+</Button.Leading>
        <Button.Text>Go</Button.Text>
        <Button.Trailing>›</Button.Trailing>
      </Button>,
    )
    const root = container.querySelector("button")
    expect(root?.getAttribute("data-adaptv")).toBe("button")
    expect(root?.getAttribute("data-part")).toBe("root")
    expect(root?.hasAttribute("class")).toBe(false)
    const named = parts(container).map((el) =>
      el.getAttribute("data-part"),
    )
    for (const part of [
      "root",
      "content-shell",
      "content",
      "leading",
      "label",
      "trailing",
    ]) {
      expect(named, part).toContain(part)
    }
    //the root alone carries `button`; each sub-part has its own `button-<part>` scope
    for (const el of parts(container)) {
      expect(el.getAttribute("data-adaptv"), el.dataset.part).toBe(
        el.dataset.part === "root"
          ? "button"
          : `button-${el.dataset.part}`,
      )
      expect(el.hasAttribute("class"), el.dataset.part).toBe(false)
    }
    //stamped once: `[data-adaptv="button"]` must not match a nested element
    expect(
      container.querySelectorAll('[data-adaptv="button"]'),
    ).toHaveLength(1)
  })

  it("passes a slot's and the label's className through untouched", () => {
    const { container } = render(
      <Button>
        <Button.Leading className="pe-2 shrink">+</Button.Leading>
        <Button.Text className="truncate">Go</Button.Text>
      </Button>,
    )
    const leading = container.querySelector<HTMLElement>(
      "[data-part='leading']",
    )
    const label = container.querySelector<HTMLElement>(
      "[data-part='label']",
    )
    expect(leading?.className).toBe("pe-2 shrink")
    expect(label?.className).toBe("truncate")
    //…and the slot's width-mode layout is locked inline, so `shrink` cannot reach it
    expect(leading?.style.display).toBe("inline-flex")
    expect(leading?.style.flexShrink).toBe("0")
    expect(leading?.style.alignItems).toBe("center")
  })

  it("locks the label's width mode inline: intrinsic by default, truncatable when fixed", () => {
    const intrinsic = render(
      <Button>
        <Button.Text>Go</Button.Text>
      </Button>,
    ).container.querySelector<HTMLElement>("[data-part='label']")
    expect(intrinsic?.style.display).toBe("inline-flex")
    expect(intrinsic?.style.flexShrink).toBe("0")
    expect(intrinsic?.style.minWidth).toBe("")

    const fixed = render(
      <Button className="w-full">
        <Button.Text>Go</Button.Text>
      </Button>,
    ).container.querySelector<HTMLElement>("[data-part='label']")
    expect(fixed?.style.display).toBe("inline-flex")
    expect(fixed?.style.minWidth).toMatch(/^0(px)?$/)
    expect(fixed?.style.flexShrink).toBe("")
  })

  it("a fixed width renders the plain measured row, no tween shell", () => {
    const { container } = render(<Button className="w-full">Go</Button>)
    expect(container.querySelector("[data-part='content']")).not.toBeNull()
    expect(
      container.querySelector("[data-part='content-shell']"),
    ).toBeNull()
  })
})

describe("Button — the default look is a layer rule (styles/button.css)", () => {
  const css = readFileSync(
    resolve(__dirname, "../styles/button.css"),
    "utf8",
  )
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "")

  it("lives in adaptv.components under :where(), with no !important", () => {
    expect(rules).toContain("@layer adaptv.components")
    expect(rules).toContain(
      ':where(\n    [data-adaptv="button"][data-part="root"]',
    )
    expect(rules).not.toContain("!important")
  })

  //⚠︎ the transparent pre-allocated border was tried and reverted (see the note on the
  //root rule): it costs every button 2px of content box and only helps a 1px border
  it("declares no border on the root", () => {
    expect(rules).not.toMatch(/\bborder(-width|-style|-color)?\s*:/)
  })
})
