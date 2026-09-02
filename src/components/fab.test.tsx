import { act, fireEvent, render, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HAPTIC_TICK_ATTR } from "#adaptv/capabilities/haptic-tick"
import { Button } from "#adaptv/components/button"
import {
  Fab,
  fabPositionStyle,
  useLayoutViewportShrink,
} from "#adaptv/components/fab"
import { KEYBOARD_MOCK_EVENT } from "#adaptv/hooks/use-keyboard"

/*
 * Two happy-dom gaps shape this file, and both are asserted on rather than worked
 * around in the component:
 *
 *   1. Its CSS parser drops a `bottom` (and `margin-bottom`) whose value composes
 *      `var()` inside `calc()`, while it keeps `inset-inline-*` with the same shape.
 *   2. React assigns `style.translate = …` as a property, and happy-dom's
 *      CSSStyleDeclaration has no `translate` accessor, so nothing reaches the
 *      attribute.
 *
 * So the position expressions are asserted on `fabPositionStyle` — the pure function
 * the component ships verbatim as its `lockedStyle` — and the DOM is asserted on the
 * keys happy-dom keeps (`position`, the inline inset, `pointer-events`) plus one
 * cross-check that the rendered inset IS the function's value, which proves the
 * wiring for the whole object.
 */

const GAP_4 = "calc(var(--spacing) * 4)"
const BOTTOM_4 = `calc(max(var(--adaptv-inset-bottom), var(--adaptv-keyboard-height)) + ${GAP_4})`

function fabEl(container: HTMLElement): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(
    "button[data-adaptv='fab']",
  )
  if (!el) throw new Error("no fab rendered")
  return el
}

/** Press the way a finger does — the press engine commits on release, not on `click`. */
function press(el: HTMLElement): void {
  el.setPointerCapture ??= () => {}
  el.releasePointerCapture ??= () => {}
  const pointer = { pointerId: 1, button: 0, isPrimary: true }
  fireEvent.pointerDown(el, pointer)
  fireEvent.pointerUp(el, pointer)
}

describe("fabPositionStyle — the safe-edge expressions", () => {
  it("end: sits above the bottom inset + keyboard, inside the trailing side inset", () => {
    const s = fabPositionStyle({
      placement: "end",
      avoidKeyboard: true,
      gap: 4,
      hidden: false,
    })
    expect(s.position).toBe("fixed")
    expect(s.bottom).toBe(BOTTOM_4)
    expect(s.insetInlineEnd).toBe(
      `calc(var(--adaptv-inset-right) + ${GAP_4})`,
    )
    expect(s.insetInlineStart).toBeUndefined()
    expect(s.translate).toBe("0 0")
    expect(s.pointerEvents).toBeUndefined()
  })

  it("start: the leading side inset, and nothing on the trailing one", () => {
    const s = fabPositionStyle({
      placement: "start",
      avoidKeyboard: true,
      gap: 4,
      hidden: false,
    })
    expect(s.bottom).toBe(BOTTOM_4)
    expect(s.insetInlineStart).toBe(
      `calc(var(--adaptv-inset-left) + ${GAP_4})`,
    )
    expect(s.insetInlineEnd).toBeUndefined()
    expect(s.translate).toBe("0 0")
  })

  it("center: 50% in, centred by a -50% translate that the exit keeps", () => {
    const resting = fabPositionStyle({
      placement: "center",
      avoidKeyboard: true,
      gap: 4,
      hidden: false,
    })
    expect(resting.bottom).toBe(BOTTOM_4)
    expect(resting.insetInlineStart).toBe("50%")
    expect(resting.insetInlineEnd).toBeUndefined()
    expect(resting.translate).toBe("-50% 0")

    const hidden = fabPositionStyle({
      placement: "center",
      avoidKeyboard: true,
      gap: 4,
      hidden: true,
    })
    //a centred button that lost its -50% would drift sideways as it leaves
    expect(hidden.translate).toBe(`-50% calc(100% + ${BOTTOM_4})`)
  })

  it("`gap` is spacing units, applied as calc(var(--spacing) * gap) on every edge", () => {
    const s = fabPositionStyle({
      placement: "end",
      avoidKeyboard: true,
      gap: 6,
      hidden: false,
    })
    expect(s.bottom).toBe(
      "calc(max(var(--adaptv-inset-bottom), var(--adaptv-keyboard-height)) + calc(var(--spacing) * 6))",
    )
    expect(s.insetInlineEnd).toBe(
      "calc(var(--adaptv-inset-right) + calc(var(--spacing) * 6))",
    )
  })

  it("avoidKeyboard={false} drops the keyboard term, and only that", () => {
    const s = fabPositionStyle({
      placement: "end",
      avoidKeyboard: false,
      gap: 4,
      hidden: false,
    })
    expect(s.bottom).toBe(`calc(var(--adaptv-inset-bottom) + ${GAP_4})`)
    expect(s.bottom).not.toContain("--adaptv-keyboard-height")
    expect(s.insetInlineEnd).toBe(
      `calc(var(--adaptv-inset-right) + ${GAP_4})`,
    )
  })

  it("hidden: the exit clears the button's own height PLUS everything under it", () => {
    const s = fabPositionStyle({
      placement: "end",
      avoidKeyboard: true,
      gap: 4,
      hidden: true,
    })
    //`100%` of a translate is the element's own box; `bottom` is the gap + inset +
    //keyboard beneath it — both have to go for the button to be off-screen
    expect(s.translate).toBe(`0 calc(100% + ${BOTTOM_4})`)
    expect(s.pointerEvents).toBe("none")
    //the anchor does not move while hidden — the motion is translate alone
    expect(s.bottom).toBe(BOTTOM_4)
  })

  it("never reads env() itself — the contract variables are the only source", () => {
    for (const placement of ["end", "center", "start"] as const) {
      const s = fabPositionStyle({
        placement,
        avoidKeyboard: true,
        gap: 4,
        hidden: true,
      })
      expect(JSON.stringify(s)).not.toContain("env(")
    }
  })
})

describe("Fab — a Button fixed to a corner", () => {
  it('renders a Button that answers to data-adaptv="fab"', () => {
    const { container } = render(<Fab aria-label="New">+</Fab>)
    const el = fabEl(container)
    expect(el.tagName).toBe("BUTTON")
    expect(el.getAttribute("type")).toBe("button")
    expect(el.getAttribute("aria-label")).toBe("New")
    //still the press engine underneath
    expect(el.getAttribute("data-press-engine")).not.toBeNull()
  })

  it("ships the position as its locked inline style (default: end, gap 4, keyboard on)", () => {
    const { container } = render(<Fab aria-label="New">+</Fab>)
    const el = fabEl(container)
    const own = fabPositionStyle({
      placement: "end",
      avoidKeyboard: true,
      gap: 4,
      hidden: false,
    })
    expect(el.style.position).toBe("fixed")
    //the cross-check: what landed is the function's value, verbatim
    expect(el.style.insetInlineEnd).toBe(own.insetInlineEnd)
    expect(el.style.insetInlineEnd).toBe(
      `calc(var(--adaptv-inset-right) + ${GAP_4})`,
    )
    expect(el.style.insetInlineStart).toBe("")
    expect(el.getAttribute("data-placement")).toBe("end")
  })

  it("gap changes the inset calc", () => {
    const { container } = render(
      <Fab aria-label="New" gap={8}>
        +
      </Fab>,
    )
    expect(fabEl(container).style.insetInlineEnd).toBe(
      "calc(var(--adaptv-inset-right) + calc(var(--spacing) * 8))",
    )
  })

  it('placement="start" anchors to the leading edge', () => {
    const { container } = render(
      <Fab aria-label="New" placement="start">
        +
      </Fab>,
    )
    const el = fabEl(container)
    expect(el.getAttribute("data-placement")).toBe("start")
    expect(el.style.insetInlineStart).toBe(
      `calc(var(--adaptv-inset-left) + ${GAP_4})`,
    )
    expect(el.style.insetInlineEnd).toBe("")
  })

  it('placement="center" anchors at 50%', () => {
    const { container } = render(
      <Fab aria-label="New" placement="center">
        +
      </Fab>,
    )
    const el = fabEl(container)
    expect(el.getAttribute("data-placement")).toBe("center")
    expect(el.style.insetInlineStart).toBe("50%")
    expect(el.style.insetInlineEnd).toBe("")
  })

  it("wears the neutral look as base, the motion as locked, on top of Button's own", () => {
    const { container } = render(<Fab aria-label="New">+</Fab>)
    const classes = fabEl(container).className.split(/\s+/)
    for (const token of [
      "h-14",
      "w-14",
      "rounded-full",
      "shadow-lg",
      "z-40",
      "transition-[translate]",
      "duration-200",
      "ease-out",
      "motion-reduce:transition-none",
    ]) {
      expect(classes, token).toContain(token)
    }
    //`w-14` is the width now; Button's intrinsic `w-fit` yields to it
    expect(classes).not.toContain("w-fit")
    //and `fixed` is inline, never a class the consumer could fight
    expect(classes).not.toContain("fixed")
  })

  it("hidden: the attribute, the a11y exit, the tab order, the inert pointer", () => {
    const { container, rerender } = render(
      <Fab aria-label="New" hidden>
        +
      </Fab>,
    )
    const el = fabEl(container)
    expect(el.hasAttribute("data-hidden")).toBe(true)
    expect(el.getAttribute("data-hidden")).toBe("")
    expect(el.getAttribute("aria-hidden")).toBe("true")
    expect(el.tabIndex).toBe(-1)
    expect(el.style.pointerEvents).toBe("none")
    //still mounted — the motion has something to play on — and NOT the native
    //`hidden` attribute, which is display:none and would kill it
    expect(el.hasAttribute("hidden")).toBe(false)
    expect(el.isConnected).toBe(true)

    rerender(<Fab aria-label="New">+</Fab>)
    expect(el.hasAttribute("data-hidden")).toBe(false)
    expect(el.hasAttribute("aria-hidden")).toBe(false)
    expect(el.tabIndex).toBe(0)
    expect(el.style.pointerEvents).toBe("")
  })

  it("keeps a consumer's own aria-hidden / tabIndex while NOT hidden", () => {
    const { container } = render(
      <Fab aria-label="New" tabIndex={-1}>
        +
      </Fab>,
    )
    const el = fabEl(container)
    //-1 is the consumer's own choice here, not the hidden state's: no data-hidden
    expect(el.tabIndex).toBe(-1)
    expect(el.hasAttribute("data-hidden")).toBe(false)
    expect(el.hasAttribute("aria-hidden")).toBe(false)
  })

  it("onClick reaches the Button's press engine (fires on release)", () => {
    const onClick = vi.fn()
    const { container } = render(
      <Fab aria-label="New" onClick={onClick}>
        +
      </Fab>,
    )
    press(fabEl(container))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("disabled reaches the Button", () => {
    const onClick = vi.fn()
    const { container } = render(
      <Fab aria-label="New" disabled onClick={onClick}>
        +
      </Fab>,
    )
    const el = fabEl(container)
    expect(el.disabled).toBe(true)
    press(el)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("takes the Button slots — the extended form is the same component", () => {
    const { container } = render(
      <Fab aria-label="New task" className="w-auto px-5">
        <Button.Leading>+</Button.Leading>
        <Button.Text>New task</Button.Text>
      </Fab>,
    )
    const el = fabEl(container)
    expect(el.textContent).toContain("New task")
    const classes = el.className.split(/\s+/)
    expect(classes).toContain("w-auto")
    expect(classes).toContain("px-5")
    //resolved by tailwind-merge, not by print order — which is why the base is
    //`h-14 w-14` and not `size-14` (a later `w-auto` never removes a `size-*`)
    expect(classes).not.toContain("w-14")
    expect(classes).toContain("h-14")
  })

  it("exposes the Button handle through ref", () => {
    let handle: { focus: () => void; disabled: boolean } | null = null
    render(
      <Fab
        aria-label="New"
        ref={(h) => {
          handle = h
        }}
      >
        +
      </Fab>,
    )
    expect(handle).not.toBeNull()
  })
})

describe("Fab haptic — routes through Button's two surfaces", () => {
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

  it("mounts the transducer when a haptic is requested — the way Button does", () => {
    forceIOSWeb()
    const { container } = render(
      <Fab aria-label="New" haptic>
        +
      </Fab>,
    )
    expect(container.querySelector(`[${HAPTIC_TICK_ATTR}]`)).not.toBeNull()
  })

  it("mounts nothing when no haptic is requested", () => {
    forceIOSWeb()
    const { container } = render(<Fab aria-label="New">+</Fab>)
    expect(container.querySelector(`[${HAPTIC_TICK_ATTR}]`)).toBeNull()
  })
})

describe("Fab and the keyboard", () => {
  type MockHost = {
    __adaptvKeyboardMock?: { isOpen: boolean; height: number }
  }
  const host = window as unknown as MockHost

  afterEach(() => {
    delete host.__adaptvKeyboardMock
  })

  function raiseKeyboard(height: number): void {
    act(() => {
      host.__adaptvKeyboardMock = { isOpen: true, height }
      window.dispatchEvent(new Event(KEYBOARD_MOCK_EVENT))
    })
  }

  function dismissKeyboard(): void {
    act(() => {
      host.__adaptvKeyboardMock = { isOpen: false, height: 0 }
      window.dispatchEvent(new Event(KEYBOARD_MOCK_EVENT))
    })
  }

  it("stamps data-keyboard-open while the keyboard is up, and publishes the height on <html>", () => {
    //the observer branches on the mock at mount, so it has to be there first
    host.__adaptvKeyboardMock = { isOpen: false, height: 0 }
    const { container } = render(<Fab aria-label="New">+</Fab>)
    const el = fabEl(container)
    expect(el.hasAttribute("data-keyboard-open")).toBe(false)

    raiseKeyboard(300)
    expect(el.getAttribute("data-keyboard-open")).toBe("")
    //the FAB's own observation is what makes the variable live — nothing else on
    //this page uses the hook, and `bottom` reads this value
    expect(
      document.documentElement.style.getPropertyValue(
        "--adaptv-keyboard-height",
      ),
    ).toBe("300px")
    expect(
      document.documentElement.hasAttribute("data-keyboard-open"),
    ).toBe(true)

    dismissKeyboard()
    expect(el.hasAttribute("data-keyboard-open")).toBe(false)
  })

  it("the height never becomes a prop — the lift is the variable inside `bottom`", () => {
    host.__adaptvKeyboardMock = { isOpen: false, height: 0 }
    const { container } = render(<Fab aria-label="New">+</Fab>)
    const el = fabEl(container)
    raiseKeyboard(300)
    //what the button carries is the composition, not the number
    expect(el.getAttribute("style")).not.toContain("300")
    const own = fabPositionStyle({
      placement: "end",
      avoidKeyboard: true,
      gap: 4,
      hidden: false,
    })
    expect(own.bottom).toContain("var(--adaptv-keyboard-height)")
  })

  it("avoidKeyboard={false} stops observing: no attribute, no publication", () => {
    host.__adaptvKeyboardMock = { isOpen: false, height: 0 }
    const { container } = render(
      <Fab aria-label="New" avoidKeyboard={false}>
        +
      </Fab>,
    )
    const el = fabEl(container)
    raiseKeyboard(300)
    expect(el.hasAttribute("data-keyboard-open")).toBe(false)
    //a disabled observer is not a publisher, so <html> keeps the stylesheet's
    //resting value rather than an inline copy
    expect(
      document.documentElement.style.getPropertyValue(
        "--adaptv-keyboard-height",
      ),
    ).toBe("")
  })

  it("subtracts the layout viewport's shrink, so a WebView that resized for the keyboard does not lift twice", () => {
    //the Android WebView: 923 → 587 for a 336px keyboard (device-measured)
    const withShrink = fabPositionStyle({
      placement: "end",
      avoidKeyboard: true,
      gap: 4,
      hidden: false,
      keyboardShrink: 336,
    })
    expect(withShrink.bottom).toBe(
      `calc(max(var(--adaptv-inset-bottom), var(--adaptv-keyboard-height) - 336px) + ${GAP_4})`,
    )
    //iOS: no resize, no subtraction — the plain variable
    expect(
      fabPositionStyle({
        placement: "end",
        avoidKeyboard: true,
        gap: 4,
        hidden: false,
        keyboardShrink: 0,
      }).bottom,
    ).toBe(BOTTOM_4)
    //lift off: the keyboard term is gone, shrink or not
    expect(
      fabPositionStyle({
        placement: "end",
        avoidKeyboard: false,
        gap: 4,
        hidden: false,
        keyboardShrink: 336,
      }).bottom,
    ).not.toContain("336")
  })

  it("useLayoutViewportShrink reads the rest height while closed and the shrink while open", () => {
    const restHeight = window.innerHeight
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useLayoutViewportShrink(active),
      { initialProps: { active: false } },
    )
    expect(result.current).toBe(0)

    //the keyboard opens and the WebView resizes by its height (Android)
    rerender({ active: true })
    act(() => {
      window.innerHeight = restHeight - 336
      window.dispatchEvent(new Event("resize"))
    })
    expect(result.current).toBe(336)

    //iOS never resizes: the shrink is 0 even with the keyboard open
    act(() => {
      window.innerHeight = restHeight
      window.dispatchEvent(new Event("resize"))
    })
    expect(result.current).toBe(0)

    //closing resets, and a resize while closed re-arms the rest height
    rerender({ active: false })
    act(() => {
      window.innerHeight = restHeight + 100
      window.dispatchEvent(new Event("resize"))
    })
    rerender({ active: true })
    act(() => {
      window.innerHeight = restHeight
      window.dispatchEvent(new Event("resize"))
    })
    expect(result.current).toBe(100)
    window.innerHeight = restHeight
  })

  it("hands <html> back on unmount", () => {
    host.__adaptvKeyboardMock = { isOpen: false, height: 0 }
    const { unmount } = render(<Fab aria-label="New">+</Fab>)
    raiseKeyboard(300)
    unmount()
    expect(
      document.documentElement.style.getPropertyValue(
        "--adaptv-keyboard-height",
      ),
    ).toBe("")
    expect(
      document.documentElement.hasAttribute("data-keyboard-open"),
    ).toBe(false)
  })
})
