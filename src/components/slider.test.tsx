import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { gestureController } from "#adaptv/capabilities/gesture-controller"
import {
  quantizeSliderValue,
  Slider,
  useSlider,
} from "#adaptv/components/slider"
import { GesturePriority } from "#adaptv/hooks/use-gesture-capture"

afterEach(cleanup)

const rootOf = (container: HTMLElement) => {
  const el = container.querySelector<HTMLElement>("[data-adaptv='slider']")
  if (!el) throw new Error("no slider root")
  return el
}
const inputOf = (container: HTMLElement) => {
  const el = container.querySelector<HTMLInputElement>("input[type=range]")
  if (!el) throw new Error("no range input")
  return el
}

/**
 * Give the root a box. happy-dom lays nothing out, so every rect is zero and
 * the pointer mapping would divide by nothing. 200px wide from x=0, with the
 * default thumb measured at 20px so the inset is exercised too.
 */
function layOut(
  root: HTMLElement,
  { width = 200, thumb = 20 }: { width?: number; thumb?: number } = {},
) {
  //happy-dom has no Pointer Capture API; the drag claims the pointer at lock
  root.setPointerCapture ??= () => {}
  root.releasePointerCapture ??= () => {}
  root.hasPointerCapture ??= () => false
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
    left: 0,
    width,
    top: 0,
    height: 44,
    right: width,
    bottom: 44,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  const thumbEl = root.querySelector<HTMLElement>(
    "[data-adaptv='slider-thumb']",
  )
  if (thumbEl) {
    vi.spyOn(thumbEl, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: thumb,
      top: 0,
      height: thumb,
      right: thumb,
      bottom: thumb,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
  }
}

type PointerType = "mouse" | "touch" | "pen"
const pointer = (
  pointerType: PointerType,
  clientX: number,
  clientY = 20,
) => ({
  pointerId: 1,
  pointerType,
  button: 0,
  isPrimary: true,
  clientX,
  clientY,
})

/** x for a value on a `width` root with a `thumb` px thumb: the thumb's centre. */
const xFor = (value: number, width = 200, thumb = 20) =>
  thumb / 2 + (value / 100) * (width - thumb)

describe("Slider value model", () => {
  it("defaults to min when uncontrolled", () => {
    const { container } = render(<Slider aria-label="v" min={10} />)
    expect(inputOf(container).value).toBe("10")
    expect(rootOf(container).style.getPropertyValue("--slider-fill")).toBe(
      "0",
    )
  })

  it("lets the controlled prop win and reports the user's change", () => {
    const onValueChange = vi.fn()
    const { container } = render(
      <Slider aria-label="v" value={30} onValueChange={onValueChange} />,
    )
    const input = inputOf(container)
    expect(input.value).toBe("30")
    fireEvent.keyDown(input, { key: "ArrowRight" })
    expect(onValueChange).toHaveBeenCalledWith(31)
    //the prop was not updated, so the control stays where the consumer holds it
    expect(input.value).toBe("30")
  })

  it("publishes --slider-fill as (value - min) / (max - min)", () => {
    const { container } = render(
      <Slider aria-label="v" min={50} max={150} value={92} />,
    )
    expect(rootOf(container).style.getPropertyValue("--slider-fill")).toBe(
      "0.42",
    )
  })
})

describe("Slider keyboard", () => {
  it("ArrowRight steps by `step`, firing onValueChange then onValueCommit once", () => {
    const calls: string[] = []
    const { container } = render(
      <Slider
        aria-label="v"
        step={5}
        onValueChange={(v) => calls.push(`change:${v}`)}
        onValueCommit={(v) => calls.push(`commit:${v}`)}
      />,
    )
    const input = inputOf(container)
    fireEvent.keyDown(input, { key: "ArrowRight" })
    fireEvent.keyUp(input, { key: "ArrowRight" })
    expect(calls).toEqual(["change:5", "commit:5"])
    expect(input.value).toBe("5")
  })

  it("a held key repeats the change and commits once on release", () => {
    const onValueCommit = vi.fn()
    const { container } = render(
      <Slider aria-label="v" onValueCommit={onValueCommit} />,
    )
    const input = inputOf(container)
    fireEvent.keyDown(input, { key: "ArrowRight" })
    fireEvent.keyDown(input, { key: "ArrowRight" })
    fireEvent.keyDown(input, { key: "ArrowRight" })
    expect(onValueCommit).not.toHaveBeenCalled()
    fireEvent.keyUp(input, { key: "ArrowRight" })
    expect(onValueCommit).toHaveBeenCalledTimes(1)
    expect(onValueCommit).toHaveBeenCalledWith(3)
  })

  //quirk 4: 0 + 0.1 + 0.1 + 0.1 is 0.30000000000000004 in floating point
  it("three presses at step 0.1 read exactly 0.3", () => {
    const onValueChange = vi.fn()
    const { container } = render(
      <Slider
        aria-label="v"
        max={1}
        step={0.1}
        onValueChange={onValueChange}
      />,
    )
    const input = inputOf(container)
    for (let i = 0; i < 3; i++) {
      fireEvent.keyDown(input, { key: "ArrowRight" })
    }
    expect(onValueChange).toHaveBeenLastCalledWith(0.3)
    expect(input.value).toBe("0.3")
  })

  it("Home and End reach the ends, and a keyless change commits at once", () => {
    const calls: string[] = []
    const { container } = render(
      <Slider
        aria-label="v"
        defaultValue={40}
        onValueChange={(v) => calls.push(`change:${v}`)}
        onValueCommit={(v) => calls.push(`commit:${v}`)}
      />,
    )
    const input = inputOf(container)
    fireEvent.keyDown(input, { key: "End" })
    fireEvent.keyUp(input, { key: "End" })
    fireEvent.keyDown(input, { key: "Home" })
    fireEvent.keyUp(input, { key: "Home" })
    //a screen reader adjusts the native value with no key events at all
    fireEvent.change(input, { target: { value: "70" } })
    expect(calls).toEqual([
      "change:100",
      "commit:100",
      "change:0",
      "commit:0",
      "change:70",
      "commit:70",
    ])
  })
})

describe("quantizeSliderValue", () => {
  it("rounds the float sum back onto the decimal grid", () => {
    expect(quantizeSliderValue(0.30000000000000004, 0, 1, 0.1)).toBe(0.3)
    expect(quantizeSliderValue(0.7 + 0.1, 0, 1, 0.1)).toBe(0.8)
  })

  it("clamps into [min, max]", () => {
    expect(quantizeSliderValue(150, 0, 100, 1)).toBe(100)
    expect(quantizeSliderValue(-5, 0, 100, 1)).toBe(0)
  })

  it("snaps to the nearest step", () => {
    expect(quantizeSliderValue(0.26, 0, 1, 0.1)).toBe(0.3)
    expect(quantizeSliderValue(0.24, 0, 1, 0.1)).toBe(0.2)
  })

  it("starts the grid at min, not at zero", () => {
    //min 5, step 3: the grid is 5, 8, 11, ... and 9 is nearer 8 than 11
    expect(quantizeSliderValue(9, 5, 20, 3)).toBe(8)
    expect(quantizeSliderValue(10, 5, 20, 3)).toBe(11)
    expect(quantizeSliderValue(5, 5, 20, 3)).toBe(5)
  })

  it("never steps past an off-grid max", () => {
    //grid 0, 3, 6, 9; 10.4 rounds up to 12 and must come back to 9
    expect(quantizeSliderValue(10.4, 0, 10, 3)).toBe(9)
  })
})

describe("Slider pointer (mouse)", () => {
  it("sets the value on pointerdown, tracks moves, and commits once on up", () => {
    const onValueChange = vi.fn()
    const onValueCommit = vi.fn()
    const { container } = render(
      <Slider
        aria-label="v"
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    )
    const root = rootOf(container)
    layOut(root)

    fireEvent.pointerDown(root, pointer("mouse", xFor(50)))
    expect(onValueChange).toHaveBeenLastCalledWith(50)
    expect(root.hasAttribute("data-dragging")).toBe(true)
    expect(inputOf(container).value).toBe("50")

    fireEvent.pointerMove(root, pointer("mouse", xFor(75)))
    expect(onValueChange).toHaveBeenLastCalledWith(75)
    expect(onValueCommit).not.toHaveBeenCalled()

    fireEvent.pointerUp(root, pointer("mouse", xFor(75)))
    expect(onValueCommit).toHaveBeenCalledTimes(1)
    expect(onValueCommit).toHaveBeenCalledWith(75)
    expect(root.hasAttribute("data-dragging")).toBe(false)
  })

  it("maps x through the thumb inset so a value round-trips to its own x", () => {
    const onValueChange = vi.fn()
    const { container } = render(
      <Slider
        aria-label="v"
        defaultValue={50}
        onValueChange={onValueChange}
      />,
    )
    const root = rootOf(container)
    layOut(root, { width: 200, thumb: 20 })
    //the thumb's centre at value 0 sits at thumb/2, at 100 at width - thumb/2;
    //a press exactly there must read the value back, and a press past either
    //end must still reach the end
    fireEvent.pointerDown(root, pointer("mouse", 10))
    expect(onValueChange).toHaveBeenLastCalledWith(0)
    fireEvent.pointerMove(root, pointer("mouse", 190))
    expect(onValueChange).toHaveBeenLastCalledWith(100)
    fireEvent.pointerMove(root, pointer("mouse", 46))
    expect(onValueChange).toHaveBeenLastCalledWith(20)
    fireEvent.pointerMove(root, pointer("mouse", 250))
    expect(onValueChange).toHaveBeenLastCalledWith(100)
    fireEvent.pointerMove(root, pointer("mouse", -40))
    expect(onValueChange).toHaveBeenLastCalledWith(0)
  })

  it("pointercancel ends the drag the same way pointerup does", () => {
    const onValueCommit = vi.fn()
    const { container } = render(
      <Slider aria-label="v" onValueCommit={onValueCommit} />,
    )
    const root = rootOf(container)
    layOut(root)
    fireEvent.pointerDown(root, pointer("mouse", xFor(50)))
    expect(root.hasAttribute("data-dragging")).toBe(true)
    fireEvent.pointerCancel(root, pointer("mouse", xFor(50)))
    expect(root.hasAttribute("data-dragging")).toBe(false)
    expect(onValueCommit).toHaveBeenCalledTimes(1)
    expect(gestureController.getCaptured()).toBeNull()
  })
})

describe("Slider pointer (touch): the axis lock", () => {
  it("a touch that goes vertical first leaves the value alone and never drags", () => {
    const onValueChange = vi.fn()
    const { container } = render(
      <Slider
        aria-label="v"
        defaultValue={40}
        onValueChange={onValueChange}
      />,
    )
    const root = rootOf(container)
    layOut(root)
    fireEvent.pointerDown(root, pointer("touch", xFor(80), 20))
    expect(root.hasAttribute("data-dragging")).toBe(false)
    //past the slop on y, barely on x: a scroll
    fireEvent.pointerMove(root, pointer("touch", xFor(80) + 2, 40))
    expect(root.hasAttribute("data-dragging")).toBe(false)
    //the gesture was abandoned: a later horizontal move does not revive it
    fireEvent.pointerMove(root, pointer("touch", xFor(10), 40))
    fireEvent.pointerUp(root, pointer("touch", xFor(10), 40))
    expect(onValueChange).not.toHaveBeenCalled()
    expect(inputOf(container).value).toBe("40")
    expect(gestureController.getCaptured()).toBeNull()
  })

  it("a touch that lifts where it landed is a tap: the lift sets the value and commits once", () => {
    //what the simulators showed before this existed: idb and `adb shell input
    //tap` on the track left the value where it was, because only a horizontal
    //move ever began a drag and a pointer that never dragged was ignored on up
    const onValueChange = vi.fn()
    const onValueCommit = vi.fn()
    const { container } = render(
      <Slider
        aria-label="v"
        defaultValue={40}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    )
    const root = rootOf(container)
    layOut(root)
    fireEvent.pointerDown(root, pointer("touch", xFor(75), 20))
    //the press alone decides nothing: the finger may be about to scroll
    expect(onValueChange).not.toHaveBeenCalled()
    expect(inputOf(container).value).toBe("40")
    fireEvent.pointerUp(root, pointer("touch", xFor(75), 20))
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith(75)
    expect(onValueCommit).toHaveBeenCalledTimes(1)
    expect(onValueCommit).toHaveBeenCalledWith(75)
    expect(inputOf(container).value).toBe("75")
    expect(root.hasAttribute("data-dragging")).toBe(false)
    expect(gestureController.getCaptured()).toBeNull()
  })

  it("a pointercancel before any axis is the platform's scroll, not a tap", () => {
    const onValueChange = vi.fn()
    const onValueCommit = vi.fn()
    const { container } = render(
      <Slider
        aria-label="v"
        defaultValue={40}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    )
    const root = rootOf(container)
    layOut(root)
    fireEvent.pointerDown(root, pointer("touch", xFor(75), 20))
    fireEvent.pointerCancel(root, pointer("touch", xFor(75), 20))
    expect(onValueChange).not.toHaveBeenCalled()
    expect(onValueCommit).not.toHaveBeenCalled()
    expect(inputOf(container).value).toBe("40")
    //and the pointer is forgotten: a stray up afterwards is nobody's tap
    fireEvent.pointerUp(root, pointer("touch", xFor(75), 20))
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it("a touch that locks horizontal claims the arbiter, drags, and commits once", () => {
    const onValueChange = vi.fn()
    const onValueCommit = vi.fn()
    const { container } = render(
      <Slider
        aria-label="v"
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    )
    const root = rootOf(container)
    layOut(root)
    fireEvent.pointerDown(root, pointer("touch", xFor(20), 20))
    //inside the slop: nothing decided yet, nothing claimed
    fireEvent.pointerMove(root, pointer("touch", xFor(20) + 3, 21))
    expect(root.hasAttribute("data-dragging")).toBe(false)
    expect(gestureController.getCaptured()).toBeNull()
    expect(onValueChange).not.toHaveBeenCalled()

    fireEvent.pointerMove(root, pointer("touch", xFor(60), 22))
    expect(root.hasAttribute("data-dragging")).toBe(true)
    expect(gestureController.getCaptured()).not.toBeNull()
    expect(gestureController.isScrollBlocked()).toBe(true)
    expect(onValueChange).toHaveBeenLastCalledWith(60)

    fireEvent.pointerUp(root, pointer("touch", xFor(60), 22))
    expect(onValueCommit).toHaveBeenCalledTimes(1)
    expect(onValueCommit).toHaveBeenCalledWith(60)
    expect(root.hasAttribute("data-dragging")).toBe(false)
    expect(gestureController.getCaptured()).toBeNull()
  })

  it("ends the drag when a higher-priority gesture takes the pointer", () => {
    const onValueCommit = vi.fn()
    const { container } = render(
      <Slider aria-label="v" onValueCommit={onValueCommit} />,
    )
    const root = rootOf(container)
    layOut(root)
    fireEvent.pointerDown(root, pointer("touch", xFor(20), 20))
    fireEvent.pointerMove(root, pointer("touch", xFor(60), 22))
    expect(root.hasAttribute("data-dragging")).toBe(true)

    act(() => {
      gestureController.requestCapture(
        "edge-swipe",
        GesturePriority.EdgeSwipe,
      )
    })
    expect(root.hasAttribute("data-dragging")).toBe(false)
    expect(onValueCommit).toHaveBeenCalledTimes(1)
    gestureController.release("edge-swipe")
  })

  it("does not start when a gesture of equal or higher priority already holds the pointer", () => {
    const onValueChange = vi.fn()
    const { container } = render(
      <Slider aria-label="v" onValueChange={onValueChange} />,
    )
    const root = rootOf(container)
    layOut(root)
    gestureController.requestCapture("drawer", GesturePriority.DrawerDrag)
    fireEvent.pointerDown(root, pointer("touch", xFor(20), 20))
    fireEvent.pointerMove(root, pointer("touch", xFor(60), 22))
    expect(root.hasAttribute("data-dragging")).toBe(false)
    expect(onValueChange).not.toHaveBeenCalled()
    expect(gestureController.getCaptured()).toBe("drawer")
    gestureController.release("drawer")
  })

  it("outranks a row swipe and yields to a drawer", () => {
    expect(GesturePriority.Slider).toBeGreaterThan(
      GesturePriority.SwipeableRow,
    )
    expect(GesturePriority.Slider).toBeLessThan(GesturePriority.DrawerDrag)
  })
})

describe("Slider disabled", () => {
  it("ignores pointer and keyboard, and says so on the root and the input", () => {
    const onValueChange = vi.fn()
    const { container } = render(
      <Slider aria-label="v" disabled onValueChange={onValueChange} />,
    )
    const root = rootOf(container)
    const input = inputOf(container)
    layOut(root)
    fireEvent.pointerDown(root, pointer("mouse", xFor(50)))
    fireEvent.pointerMove(root, pointer("mouse", xFor(70)))
    fireEvent.pointerUp(root, pointer("mouse", xFor(70)))
    fireEvent.keyDown(input, { key: "ArrowRight" })
    expect(onValueChange).not.toHaveBeenCalled()
    expect(root.hasAttribute("data-dragging")).toBe(false)
    //boolean presence, per docs/decisions/styling.md §3.1
    expect(root.getAttribute("data-disabled")).toBe("")
    expect(input.disabled).toBe(true)
    //every axis goes back to the browser on an inert control
    expect(root.className).toContain("touch-pan-x")
  })
})

describe("Slider semantics", () => {
  it("keeps a real range input carrying the value, the bounds and the label", () => {
    const { container } = render(
      <Slider
        aria-label="Volume"
        name="vol"
        id="vol-input"
        min={10}
        max={90}
        step={5}
        value={35}
      />,
    )
    const input = inputOf(container)
    expect(input.type).toBe("range")
    expect(input.getAttribute("aria-label")).toBe("Volume")
    expect(input.name).toBe("vol")
    expect(input.id).toBe("vol-input")
    expect(input.getAttribute("min")).toBe("10")
    expect(input.getAttribute("max")).toBe("90")
    expect(input.getAttribute("step")).toBe("5")
    expect(input.value).toBe("35")
  })

  it("spells its state as presence attributes, never data-state", () => {
    const { container } = render(<Slider aria-label="v" />)
    const root = rootOf(container)
    expect(root.getAttribute("data-orientation")).toBe("horizontal")
    expect(root.hasAttribute("data-state")).toBe(false)
    layOut(root)
    fireEvent.pointerDown(root, pointer("mouse", xFor(50)))
    expect(root.getAttribute("data-dragging")).toBe("")
    expect(root.hasAttribute("data-state")).toBe(false)
  })

  it("renders the default slots when children are omitted, with their names", () => {
    const { container } = render(<Slider aria-label="v" />)
    expect(
      container.querySelector("[data-adaptv='slider-track']"),
    ).not.toBe(null)
    expect(
      container.querySelector("[data-adaptv='slider-range']"),
    ).not.toBe(null)
    expect(
      container.querySelector("[data-adaptv='slider-thumb']"),
    ).not.toBe(null)
    expect(Slider.displayName).toBe("Slider")
    expect(Slider.Track.displayName).toBe("Slider.Track")
    expect(Slider.Range.displayName).toBe("Slider.Range")
    expect(Slider.Thumb.displayName).toBe("Slider.Thumb")
  })

  it("useSlider throws outside a Slider and reads the state inside one", () => {
    const seen: unknown[] = []
    function Probe() {
      seen.push(useSlider())
      return null
    }
    expect(() => render(<Probe />)).toThrow(/within <Slider>/)
    render(
      <Slider aria-label="v" min={0} max={200} value={50}>
        <Probe />
      </Slider>,
    )
    expect(seen.at(-1)).toMatchObject({
      value: 50,
      min: 0,
      max: 200,
      step: 1,
      percent: 0.25,
      isDragging: false,
      isDisabled: false,
    })
  })
})

describe("Slider locked layer", () => {
  it("keeps the touch-action longhand against a consumer touch utility", () => {
    const { container } = render(
      <Slider
        aria-label="v"
        className="touch-none touch-manipulation p-2"
      />,
    )
    const root = rootOf(container)
    //`manipulation` kills pointercancel on iOS (WebKit 240917); `none` would
    //swallow the vertical pan the longhand hands back to the page
    expect(root.className).toContain("touch-pan-y")
    expect(root.className).toContain("touch-pinch-zoom")
    expect(root.className).not.toContain("touch-none")
    expect(root.className).not.toContain("touch-manipulation")
    expect(root.className).toContain("relative")
    expect(root.className).toContain("p-2")
  })

  it("forwards the consumer's inline style without losing the fill", () => {
    const { container } = render(
      <Slider
        aria-label="v"
        value={25}
        style={{ color: "rgb(255, 0, 0)" }}
      />,
    )
    const root = rootOf(container)
    expect(root.style.color).toBe("rgb(255, 0, 0)")
    expect(root.style.getPropertyValue("--slider-fill")).toBe("0.25")
  })

  it("the thumb and range read the fill, and the thumb pulls back by its own width", () => {
    //happy-dom validates `left` and `width` and drops a `calc(var())` it cannot
    //evaluate, so the DOM would show an empty string for a declaration every
    //browser accepts. The server markup carries the inline style verbatim.
    const html = renderToStaticMarkup(<Slider aria-label="v" value={25} />)
    const thumb = html.match(
      /<span[^>]*data-adaptv="slider-thumb"[^>]*>/,
    )?.[0]
    const range = html.match(
      /<div[^>]*data-adaptv="slider-range"[^>]*>/,
    )?.[0]
    expect(thumb).toContain("left:calc(var(--slider-fill) * 100%)")
    expect(thumb).toContain(
      "translate:calc(var(--slider-fill) * -100%) -50%",
    )
    expect(range).toContain("width:calc(var(--slider-fill) * 100%)")
  })
})
