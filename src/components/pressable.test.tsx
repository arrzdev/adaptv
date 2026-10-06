import { act, fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Pressable } from "#adaptv/components/pressable"

/**
 * Press an element the way a finger does.
 *
 * `fireEvent.click` does NOT work: the press engine commits on gesture release
 * (`onPointerUp`), not on the DOM `click` — that is what lets a press survive a
 * thumb-roll and be cancelled by a scroll take-over — and it actively swallows the
 * trailing native click.
 */
function press(el: HTMLElement, { release = true } = {}): void {
  //happy-dom has no Pointer Capture API; the engine claims the pointer on press
  el.setPointerCapture ??= () => {}
  el.releasePointerCapture ??= () => {}
  //`isPrimary` must be explicit: synthetic PointerEvents default it to FALSE, and
  //the engine ignores non-primary pointers so a second finger can't fire a tap.
  const pointer = { pointerId: 1, button: 0, isPrimary: true }
  fireEvent.pointerDown(el, pointer)
  if (release) fireEvent.pointerUp(el, pointer)
}

const host = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-adaptv='pressable']")

describe("Pressable — the press engine, made obvious", () => {
  it("fires onPress on gesture release", () => {
    const onPress = vi.fn()
    const { container } = render(<Pressable onPress={onPress} />)
    const el = host(container)
    if (!el) throw new Error("no host element")
    press(el)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  //the whole reason `data-pressed` exists rather than `:active`: native :active
  //can't be cleared from JS and won't re-light on touch re-entry
  it("mirrors the live press onto the DOM as data-pressed, with no re-render", () => {
    vi.useFakeTimers()
    const renders = vi.fn()
    function Probe() {
      renders()
      return <Pressable />
    }
    const { container } = render(<Probe />)
    const el = host(container)
    if (!el) throw new Error("no host element")

    /*
     * The flag is DEFERRED, not immediate — the engine waits out the window in which
     * the browser may still turn the touch into a scroll, so a swipe that starts on a
     * Pressable never flashes it (use-gesture-engine.ts, Ionic's `tap-click` pair).
     * Advancing the clock is therefore part of the contract, not test scaffolding.
     */
    press(el, { release: false })
    expect(el.hasAttribute("data-pressed")).toBe(false)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(el.hasAttribute("data-pressed")).toBe(true)
    press(el)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(el.hasAttribute("data-pressed")).toBe(false)
    //the engine writes the attribute with setAttribute precisely so a press costs
    //no React work — a re-render here would be the regression
    expect(renders).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it("drops the gesture when disabled, and says so as data-* + aria-*", () => {
    const onPress = vi.fn()
    const { container } = render(<Pressable disabled onPress={onPress} />)
    const el = host(container)
    if (!el) throw new Error("no host element")
    press(el)
    expect(onPress).not.toHaveBeenCalled()
    //boolean presence, per docs/decisions/styling.md §3.1 — not data-state="disabled"
    expect(el.getAttribute("data-disabled")).toBe("")
    expect(el.getAttribute("aria-disabled")).toBe("true")
  })
})

describe("Pressable — the locked tier", () => {
  //`touch-action: pan-x pan-y pinch-zoom` is the WebKit 240917 workaround that keeps
  //`pointercancel` alive on iOS. A consumer `touch-none` would strand the engine's
  //state machine, so the lock is inline style, which no class reaches.
  it("locks the touch pass-through inline, against a consumer class and style", () => {
    const { container } = render(
      <Pressable
        className="touch-none p-4"
        style={{ touchAction: "none", color: "rgb(255, 0, 0)" }}
      />,
    )
    const el = host(container)
    expect(el?.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    //the rest of the consumer's style is untouched
    expect(el?.style.color).toBe("rgb(255, 0, 0)")
    //the consumer's className passes through untouched, and Pressable adds none
    expect(el?.className).toBe("touch-none p-4")
  })

  it("emits no class of its own, and says what it is with data-adaptv + data-part", () => {
    const el = host(render(<Pressable />).container)
    expect(el?.hasAttribute("class")).toBe(false)
    expect(el?.getAttribute("data-part")).toBe("root")
  })

  it("keeps a data-part the node already carries", () => {
    const fromProp = host(render(<Pressable data-part="row" />).container)
    expect(fromProp?.getAttribute("data-part")).toBe("row")
    const fromElement = host(
      render(<Pressable render={<li data-part="tile" />} />).container,
    )
    expect(fromElement?.getAttribute("data-part")).toBe("tile")
  })

  it("stays scrollable-through when disabled, and says it is disabled", () => {
    //Pressable has no native `disabled` attribute to lean on (its host is a div), so
    //the inert-ness lives in the engine and in `aria-disabled`. `touch-action: none`
    //would only have cost the page its scroll — see button.test.tsx for the measurement.
    const el = host(
      render(<Pressable disabled className="p-4" />).container,
    )
    expect(el?.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    //an inert target's label is not selectable, whatever the consumer's style says
    expect(el?.style.userSelect).toBe("none")
    expect(el?.getAttribute("aria-disabled")).toBe("true")
    expect(el?.hasAttribute("data-disabled")).toBe(true)
  })

  it("locks user-select only while disabled", () => {
    const el = host(render(<Pressable />).container)
    expect(el?.style.userSelect).toBe("")
  })

  //inline style is its own cascade origin, so a forwarded `style` would otherwise
  //beat every lock — it goes through mergeStyles' inline tier instead
  it("forwards the consumer's inline style through the style tier", () => {
    const { container } = render(
      <Pressable style={{ color: "rgb(255, 0, 0)" }} />,
    )
    expect(host(container)?.style.color).toBe("rgb(255, 0, 0)")
  })
})

describe("Pressable — render (a prop, not asChild)", () => {
  it("renders the given element and keeps its own children", () => {
    const { container } = render(
      <Pressable render={<a href="/x">label</a>} />,
    )
    const el = host(container)
    expect(el?.tagName).toBe("A")
    expect(el?.getAttribute("href")).toBe("/x")
    expect(el?.textContent).toBe("label")
  })

  it("lets Pressable's own children replace the element's", () => {
    const { container } = render(
      <Pressable render={<a href="/x">original</a>}>replaced</Pressable>,
    )
    expect(host(container)?.textContent).toBe("replaced")
  })

  it("wires the press engine to the rendered element", () => {
    const onPress = vi.fn()
    const { container } = render(
      <Pressable onPress={onPress} render={<li />} />,
    )
    const el = host(container)
    if (!el) throw new Error("no host element")
    press(el)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  //§3.3's trap: no library resolves Tailwind conflicts on composition, and the two
  //that do it at all concatenate in opposite orders. adaptv routes composition
  //through mergeStyles, so the lock still wins and the two consumer sources merge.
  it("merges the element's className through mergeStyles, not concatenation", () => {
    const { container } = render(
      <Pressable
        className="p-4 touch-none"
        render={<span className="p-2 rounded" />}
      />,
    )
    const el = host(container)
    //the element's own class survives where it doesn't conflict…
    expect(el?.className).toContain("rounded")
    //…the more local `className` prop wins where it does…
    expect(el?.className).toContain("p-4")
    expect(el?.className).not.toContain("p-2")
    //…and the lock, inline, still beats both
    expect(el?.style.touchAction).toBe("pan-x pan-y pinch-zoom")
    expect(el?.className).not.toContain("touch-pan-x")
  })

  it("merges the element's inline style per property", () => {
    const { container } = render(
      <Pressable
        style={{ color: "rgb(0, 0, 255)" }}
        render={<span style={{ color: "rgb(255, 0, 0)", opacity: 0.5 }} />}
      />,
    )
    const el = host(container)
    expect(el?.style.color).toBe("rgb(0, 0, 255)")
    expect(el?.style.opacity).toBe("0.5")
  })

  //the capability `cloneElement` structurally cannot have: state-dependent CONTENT
  it("accepts a function form receiving (props, state)", () => {
    const { container } = render(
      <Pressable
        disabled
        render={(props, state) => (
          <button type="button" {...props}>
            {state.disabled ? "off" : "on"}
          </button>
        )}
      />,
    )
    const el = host(container)
    expect(el?.tagName).toBe("BUTTON")
    expect(el?.textContent).toBe("off")
  })
})
