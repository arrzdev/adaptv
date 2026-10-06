import { fireEvent, render, screen } from "@testing-library/react"
import type { KeyboardEvent, Ref } from "react"
import { act, createRef, useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TextAreaHandle } from "#adaptv/components/text-area"
import { TextArea, useTextArea } from "#adaptv/components/text-area"

/*
 * TextArea's behaviour past its class strings (style-precedence.test.tsx owns those):
 * the slot contract, the handle, the submit key, the shell's focus handling, and the
 * auto-resize engine.
 *
 * happy-dom has no layout, so the engine runs against a small fake one (below):
 * content is 20px a line, a box is as tall as its inline height or one row, and the
 * computed styles the engine reads are served per element. Frames and resize
 * notifications are queued by hand so a test decides when each one lands.
 */

const restores: Array<() => void> = []

afterEach(() => {
  for (const restore of restores.splice(0)) restore()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function stubTouchDevice(): void {
  const prev = Object.getOwnPropertyDescriptor(navigator, "maxTouchPoints")
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: 5,
    configurable: true,
  })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, "maxTouchPoints", prev)
    else
      delete (navigator as unknown as Record<string, unknown>)
        .maxTouchPoints
  })
}

function silenceRenderErrors(): void {
  vi.spyOn(console, "error").mockImplementation(() => undefined)
}

function textarea(): HTMLTextAreaElement {
  const el = document.querySelector("textarea")
  if (!el) throw new Error("no <textarea> rendered")
  return el
}

function shell(): HTMLElement {
  const el = textarea().parentElement
  if (!el) throw new Error("the <textarea> has no shell")
  return el
}

describe("useTextArea", () => {
  it("throws outside a <TextArea>", () => {
    silenceRenderErrors()
    function Probe() {
      useTextArea()
      return null
    }
    expect(() => render(<Probe />)).toThrow(
      "useTextArea must be used within a <TextArea> with Label, Hint, or Error slots.",
    )
  })

  it("a slot rendered outside a <TextArea> throws the same way", () => {
    silenceRenderErrors()
    expect(() => render(<TextArea.Hint>h</TextArea.Hint>)).toThrow(
      "useTextArea must be used within",
    )
  })
})

describe("TextArea — slot validation", () => {
  it.each([
    [
      "text",
      "loose text",
      "TextArea accepts only TextArea.Label, TextArea.Hint, and TextArea.Error children.",
    ],
    [
      "a number",
      7,
      "TextArea accepts only TextArea.Label, TextArea.Hint, and TextArea.Error children.",
    ],
    [
      "a foreign element",
      <div key="d" />,
      "TextArea accepts only TextArea.Label, TextArea.Hint, and TextArea.Error as direct children.",
    ],
    [
      "a second Label",
      [
        <TextArea.Label key="a">a</TextArea.Label>,
        <TextArea.Label key="b">b</TextArea.Label>,
      ],
      "TextArea accepts only one <TextArea.Label> child.",
    ],
    [
      "a second Hint",
      [
        <TextArea.Hint key="a">a</TextArea.Hint>,
        <TextArea.Hint key="b">b</TextArea.Hint>,
      ],
      "TextArea accepts only one <TextArea.Hint> child.",
    ],
    [
      "a second Error",
      [
        <TextArea.Error key="a">a</TextArea.Error>,
        <TextArea.Error key="b">b</TextArea.Error>,
      ],
      "TextArea accepts only one <TextArea.Error> child.",
    ],
  ])("throws for %s", (_, children, message) => {
    silenceRenderErrors()
    expect(() => render(<TextArea>{children}</TextArea>)).toThrow(message)
  })

  it("`null`, `undefined` and `false` children are no slots: the shell is the root", () => {
    const { container } = render(
      <TextArea aria-label="notes">
        {null}
        {undefined}
        {false}
      </TextArea>,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.tagName).toBe("DIV")
    expect(root).toBe(shell())
    expect(root.getAttribute("data-adaptv")).toBe("text-area")
    expect(root.getAttribute("data-part")).toBe("root")
    expect(textarea().hasAttribute("aria-describedby")).toBe(false)
  })
})

describe("TextArea — slot wiring", () => {
  it("wraps the parts in a fieldset that owns the identity, in label → field → hint → error order", () => {
    const { container } = render(
      <TextArea>
        <TextArea.Error>bad</TextArea.Error>
        <TextArea.Hint>help</TextArea.Hint>
        <TextArea.Label>Notes</TextArea.Label>
      </TextArea>,
    )
    const fieldset = container.firstElementChild as HTMLFieldSetElement
    expect(fieldset.tagName).toBe("FIELDSET")
    expect(fieldset.getAttribute("data-adaptv")).toBe("text-area")
    //stamped once: `[data-adaptv="text-area"]` must not match two nested elements
    expect(shell().hasAttribute("data-adaptv")).toBe(false)
    expect(
      container.querySelectorAll('[data-adaptv="text-area"]'),
    ).toHaveLength(1)
    expect(fieldset.getAttribute("data-part")).toBe("root")
    expect(shell().getAttribute("data-part")).toBe("shell")
    //the inner field is a part with its own scope
    expect(textarea().getAttribute("data-adaptv")).toBe("text-area-field")
    expect(Array.from(fieldset.children).map((el) => el.tagName)).toEqual([
      "LABEL",
      "DIV",
      "P",
      "P",
    ])
    expect(fieldset.children[2]?.textContent).toBe("help")
    expect(fieldset.children[3]?.textContent).toBe("bad")
  })

  it("points the label at the field and describes the field by hint then error", () => {
    const { container } = render(
      <TextArea id="notes">
        <TextArea.Label>Notes</TextArea.Label>
        <TextArea.Hint>help</TextArea.Hint>
        <TextArea.Error>bad</TextArea.Error>
      </TextArea>,
    )
    const label = container.querySelector("label") as HTMLLabelElement
    const [hint, error] = Array.from(container.querySelectorAll("p"))
    expect(textarea().id).toBe("notes")
    expect(label.htmlFor).toBe("notes")
    expect(hint?.id).toBeTruthy()
    expect(error?.id).toBeTruthy()
    expect(hint?.id).not.toBe(error?.id)
    expect(error?.getAttribute("role")).toBe("alert")
    expect(textarea().getAttribute("aria-describedby")).toBe(
      `${hint?.id} ${error?.id}`,
    )
  })

  it("describes the field by only the parts that are present", () => {
    const { rerender } = render(
      <TextArea>
        <TextArea.Label>Notes</TextArea.Label>
      </TextArea>,
    )
    expect(textarea().hasAttribute("aria-describedby")).toBe(false)

    rerender(
      <TextArea>
        <TextArea.Error>bad</TextArea.Error>
      </TextArea>,
    )
    const error = document.querySelector("p") as HTMLElement
    expect(textarea().getAttribute("aria-describedby")).toBe(error.id)
  })

  it("a Tier 2 part named like a slot replaces it and reads its ids from useTextArea", () => {
    const seen: Array<ReturnType<typeof useTextArea>> = []
    function BrandHint({ children }: { children: string }) {
      const ctx = useTextArea()
      seen.push(ctx)
      return (
        <small id={ctx.hintId} data-testid="brand-hint">
          {children}
        </small>
      )
    }
    BrandHint.displayName = "TextArea.Hint"

    render(
      <TextArea disabled>
        <BrandHint>help</BrandHint>
      </TextArea>,
    )
    const hint = document.querySelector("[data-testid=brand-hint]")
    expect(hint?.id).toBeTruthy()
    expect(textarea().getAttribute("aria-describedby")).toBe(hint?.id)
    expect(seen.at(-1)).toMatchObject({
      isDisabled: true,
      fieldId: textarea().id,
      errorId: undefined,
    })
  })

  it.each([
    ["TextArea.Label", "LABEL"],
    ["TextArea.Error", "P"],
  ])("a component named %s is accepted as that slot", (displayName) => {
    function Part() {
      return <span data-testid="part">part</span>
    }
    Part.displayName = displayName
    const { container } = render(
      <TextArea>
        <Part />
      </TextArea>,
    )
    expect(container.firstElementChild?.tagName).toBe("FIELDSET")
    expect(container.querySelector("[data-testid=part]")).not.toBeNull()
  })

  it("disabling the field disables the fieldset and tells the parts", () => {
    const seen: boolean[] = []
    function Probe() {
      seen.push(useTextArea().isDisabled)
      return <>probe</>
    }
    const { container } = render(
      <TextArea disabled>
        <TextArea.Label>
          <Probe />
        </TextArea.Label>
      </TextArea>,
    )
    expect(
      (container.firstElementChild as HTMLFieldSetElement).disabled,
    ).toBe(true)
    expect(textarea().disabled).toBe(true)
    expect(seen.at(-1)).toBe(true)
  })
})

describe("TextArea — a consumer aria-describedby joins the slot wiring", () => {
  //a consumer describing the field by an element of its own (a character counter,
  //a policy note) must not silently unhook the Hint and Error from screen readers
  it("keeps the consumer's ids first, then the hint, then the error", () => {
    render(
      <TextArea aria-describedby="counter policy">
        <TextArea.Hint>help</TextArea.Hint>
        <TextArea.Error>bad</TextArea.Error>
      </TextArea>,
    )
    const [hint, error] = Array.from(document.querySelectorAll("p"))
    expect(textarea().getAttribute("aria-describedby")).toBe(
      `counter policy ${hint?.id} ${error?.id}`,
    )
  })

  it("keeps the hint when only a hint is present", () => {
    render(
      <TextArea aria-describedby="counter">
        <TextArea.Hint>help</TextArea.Hint>
      </TextArea>,
    )
    const hint = document.querySelector("p") as HTMLElement
    expect(textarea().getAttribute("aria-describedby")).toBe(
      `counter ${hint.id}`,
    )
  })

  it("drops repeated and blank ids", () => {
    render(
      <TextArea
        aria-label="notes"
        aria-describedby=" counter  counter "
      />,
    )
    expect(textarea().getAttribute("aria-describedby")).toBe("counter")
  })

  it("omits the attribute when nothing is left", () => {
    render(<TextArea aria-label="notes" aria-describedby="   " />)
    expect(textarea().hasAttribute("aria-describedby")).toBe(false)
  })
})

describe("TextArea — imperative handle", () => {
  it("reads the live value and disabled state from the DOM", () => {
    const ref = createRef<TextAreaHandle>()
    const { rerender } = render(
      <TextArea ref={ref} aria-label="notes" defaultValue="hi" />,
    )
    expect(ref.current?.value).toBe("hi")
    expect(ref.current?.disabled).toBe(false)

    fireEvent.change(textarea(), { target: { value: "typed" } })
    expect(ref.current?.value).toBe("typed")

    rerender(
      <TextArea ref={ref} aria-label="notes" defaultValue="hi" disabled />,
    )
    expect(ref.current?.disabled).toBe(true)
  })

  it("focus() focuses the underlying <textarea>", () => {
    const ref = createRef<TextAreaHandle>()
    render(
      <TextArea ref={ref}>
        <TextArea.Label>Notes</TextArea.Label>
      </TextArea>,
    )
    ref.current?.focus()
    expect(document.activeElement).toBe(textarea())
  })

  it("clear() empties the field and dispatches bubbling native input and change", () => {
    const ref = createRef<TextAreaHandle>()
    render(<TextArea ref={ref} aria-label="notes" defaultValue="hello" />)
    const seen: string[] = []
    const onEvent = (e: Event) => {
      seen.push(
        `${e.type}:${e.bubbles}:${(e.target as HTMLTextAreaElement).value}`,
      )
    }
    document.addEventListener("input", onEvent)
    document.addEventListener("change", onEvent)
    restores.push(() => {
      document.removeEventListener("input", onEvent)
      document.removeEventListener("change", onEvent)
    })

    ref.current?.clear()

    expect(textarea().value).toBe("")
    expect(ref.current?.value).toBe("")
    expect(seen).toEqual(["input:true:", "change:true:"])
  })
})

describe("TextArea — clear() is an edit React sees", () => {
  function Notes({
    handle,
    initial = "hello",
  }: {
    handle: Ref<TextAreaHandle>
    initial?: string
  }) {
    const [value, setValue] = useState(initial)
    return (
      <>
        <TextArea
          ref={handle}
          aria-label="notes"
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <output data-testid="state">{value}</output>
      </>
    )
  }

  it("a controlled field's state follows the DOM to empty", () => {
    const ref = createRef<TextAreaHandle>()
    render(<Notes handle={ref} />)

    act(() => ref.current?.clear())

    expect(textarea().value).toBe("")
    expect(screen.getByTestId("state").textContent).toBe("")
  })

  it("an uncontrolled field's onChange runs once, with the empty value", () => {
    const ref = createRef<TextAreaHandle>()
    const onChange = vi.fn(
      (e: { target: HTMLTextAreaElement }) => e.target.value,
    )
    render(
      <TextArea
        ref={ref}
        aria-label="notes"
        defaultValue="hello"
        onChange={onChange}
      />,
    )

    act(() => ref.current?.clear())

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.results[0]?.value).toBe("")
    expect(ref.current?.value).toBe("")
  })

  describe("with layout", () => {
    beforeEach(installFakeLayout)

    it("a controlled field that is cleared shrinks back to its rows floor", () => {
      const ref = createRef<TextAreaHandle>()
      render(<Notes handle={ref} initial={lines(6)} />)
      expect(heightPx()).toBe(6 * LINE)

      act(() => ref.current?.clear())

      expect(heightPx()).toBe(2 * LINE)
    })
  })
})

describe("TextArea — onSubmitKey", () => {
  it("fires once on Enter, cancels the newline and stops it bubbling, and still calls onKeyDown", () => {
    const onSubmitKey = vi.fn()
    const onKeyDown = vi.fn()
    const onParentKeyDown = vi.fn()
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: a bubbling probe, not a control
      <div onKeyDown={onParentKeyDown}>
        <TextArea
          aria-label="notes"
          onSubmitKey={onSubmitKey}
          onKeyDown={onKeyDown}
        />
      </div>,
    )
    expect(fireEvent.keyDown(textarea(), { key: "Enter" })).toBe(false)
    expect(onSubmitKey).toHaveBeenCalledTimes(1)
    expect(onParentKeyDown).not.toHaveBeenCalled()
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect((onKeyDown.mock.calls[0]?.[0] as KeyboardEvent).key).toBe(
      "Enter",
    )
  })

  it("Shift+Enter is a newline, not a submit", () => {
    const onSubmitKey = vi.fn()
    const onParentKeyDown = vi.fn()
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: a bubbling probe, not a control
      <div onKeyDown={onParentKeyDown}>
        <TextArea aria-label="notes" onSubmitKey={onSubmitKey} />
      </div>,
    )
    expect(
      fireEvent.keyDown(textarea(), { key: "Enter", shiftKey: true }),
    ).toBe(true)
    expect(fireEvent.keyDown(textarea(), { key: "a" })).toBe(true)
    expect(onSubmitKey).not.toHaveBeenCalled()
    expect(onParentKeyDown).toHaveBeenCalledTimes(2)
  })

  it("is ignored on a touch device, where Enter is the soft keyboard's newline", () => {
    stubTouchDevice()
    const onSubmitKey = vi.fn()
    const onKeyDown = vi.fn()
    render(
      <TextArea
        aria-label="notes"
        onSubmitKey={onSubmitKey}
        onKeyDown={onKeyDown}
      />,
    )
    expect(fireEvent.keyDown(textarea(), { key: "Enter" })).toBe(true)
    expect(onSubmitKey).not.toHaveBeenCalled()
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  it("without onSubmitKey, Enter is a newline", () => {
    render(<TextArea aria-label="notes" />)
    expect(fireEvent.keyDown(textarea(), { key: "Enter" })).toBe(true)
  })
})

describe("TextArea shell — a press on the padding band lands in the field", () => {
  it("focuses the field and cancels the press when the field is not focused", () => {
    render(
      <TextArea>
        <TextArea.Label>Notes</TextArea.Label>
      </TextArea>,
    )
    expect(document.activeElement).not.toBe(textarea())
    expect(fireEvent.mouseDown(shell())).toBe(false)
    expect(document.activeElement).toBe(textarea())
  })

  it("cancels the press on an already-focused field, so focus is not lost", () => {
    render(<TextArea aria-label="notes" />)
    textarea().focus()
    expect(fireEvent.mouseDown(shell())).toBe(false)
    expect(document.activeElement).toBe(textarea())
  })

  it("never cancels a press on the field itself — that would break caret placement", () => {
    render(<TextArea aria-label="notes" />)
    expect(fireEvent.mouseDown(textarea())).toBe(true)
    textarea().focus()
    expect(fireEvent.mouseDown(textarea())).toBe(true)
  })
})

/* =============================================================================
 * The fake layout
 * ============================================================================= */

const LINE = 20
const ROOT_FONT = 16

type FakeLayout = {
  //box height of a field with no inline height (the `rows="1"` box, or the
  //height a fill-mode container hands it)
  autoBoxHeight: number
  shellPadding: [top: number, bottom: number]
  shellBorder: [top: number, bottom: number]
  shellMaxHeight: string
  parentMaxHeight: string
  shellTopInParent: number
}

let layout: FakeLayout
//how many lines the placeholder takes in an EMPTY field. WebKit folds the
//placeholder into an empty textarea's scrollHeight, so this is what the engine
//reads there before any text exists
let placeholderLines: number
let frames: Map<number, FrameRequestCallback>
let observers: FakeResizeObserver[]

class FakeResizeObserver {
  readonly observed = new Set<Element>()
  disconnected = false
  constructor(private readonly callback: ResizeObserverCallback) {
    observers.push(this)
  }
  observe(target: Element) {
    this.observed.add(target)
  }
  unobserve(target: Element) {
    this.observed.delete(target)
  }
  disconnect() {
    this.disconnected = true
    this.observed.clear()
  }
  notify() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

function lines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i}`).join("\n")
}

function contentHeight(el: HTMLTextAreaElement): number {
  if (el.value === "") return placeholderLines * LINE
  return el.value.split("\n").length * LINE
}

function boxHeight(el: HTMLTextAreaElement): number {
  const h = el.style.height
  if (!h || h === "auto") return layout.autoBoxHeight
  return parseFloat(h) * (h.endsWith("rem") ? ROOT_FONT : 1)
}

function px(n: number): string {
  return `${n}px`
}

function fakeComputedStyle(el: Element): CSSStyleDeclaration {
  const style: Record<string, string> = {
    display: "block",
    visibility: "visible",
    fontSize: px(ROOT_FONT),
    lineHeight: "normal",
    paddingTop: "0px",
    paddingBottom: "0px",
    borderTopWidth: "0px",
    borderBottomWidth: "0px",
    maxHeight: "none",
    height: "auto",
  }
  if (el.tagName === "TEXTAREA") {
    style.lineHeight = px(LINE)
  } else if (el.querySelector(":scope > textarea")) {
    style.paddingTop = px(layout.shellPadding[0])
    style.paddingBottom = px(layout.shellPadding[1])
    style.borderTopWidth = px(layout.shellBorder[0])
    style.borderBottomWidth = px(layout.shellBorder[1])
    style.maxHeight = layout.shellMaxHeight
  } else if (el !== document.documentElement) {
    style.maxHeight = layout.parentMaxHeight
  }
  return style as unknown as CSSStyleDeclaration
}

function defineTextAreaGeometry(): void {
  const proto = HTMLTextAreaElement.prototype
  const getters: Record<string, (el: HTMLTextAreaElement) => number> = {
    clientHeight: boxHeight,
    offsetHeight: boxHeight,
    scrollHeight: (el) => Math.max(contentHeight(el), boxHeight(el)),
  }
  for (const [name, get] of Object.entries(getters)) {
    Object.defineProperty(proto, name, {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        return get(this)
      },
    })
  }
  restores.push(() => {
    for (const name of Object.keys(getters)) {
      delete (proto as unknown as Record<string, unknown>)[name]
    }
  })
}

function installFakeLayout(): void {
  layout = {
    autoBoxHeight: LINE,
    shellPadding: [0, 0],
    shellBorder: [0, 0],
    shellMaxHeight: "none",
    parentMaxHeight: "none",
    shellTopInParent: 0,
  }
  placeholderLines = 1
  frames = new Map()
  observers = []
  let nextFrame = 1

  defineTextAreaGeometry()
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    fakeComputedStyle,
  )
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const top =
        this.querySelector(":scope > textarea") !== null
          ? layout.shellTopInParent
          : 0
      return { top, bottom: top, left: 0, right: 0 } as DOMRect
    },
  )
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, cb)
    return id
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id)
  })
  vi.stubGlobal("ResizeObserver", FakeResizeObserver)
}

function flushFrames(): void {
  act(() => {
    const due = [...frames.values()]
    frames.clear()
    for (const cb of due) cb(0)
  })
}

function heightPx(): number | null {
  const h = textarea().style.height
  if (!h || h === "auto") return null
  return boxHeight(textarea())
}

//what a keystroke looks like to the engine: the value changes, then `input` fires
//with the kind of edit that produced it
function edit(value: string, inputType = "insertText"): void {
  fireEvent.input(textarea(), { target: { value }, inputType })
}

function isScrollPadded(): boolean {
  return textarea().style.getPropertyValue("scroll-padding-bottom") !== ""
}

//the at-max-rows scroll is a LOCK, so it is inline style React writes, not a class
function hasOverflowLock(): boolean {
  return textarea().style.overflowY === "auto"
}

describe("TextArea autoResize — grow and shrink", () => {
  beforeEach(installFakeLayout)

  it("measures against a one-row box and floors the height at `rows`", () => {
    render(<TextArea aria-label="notes" rows={4} />)
    //one row, so scrollHeight reports the content rather than a rows-tall box
    expect(textarea().getAttribute("rows")).toBe("1")
    expect(heightPx()).toBe(4 * LINE)
    expect(textarea().style.height).toBe("5rem")
  })

  it("grows on the next frame after an edit, not in the input event", () => {
    render(<TextArea aria-label="notes" rows={4} />)
    edit(lines(6))
    expect(heightPx()).toBe(4 * LINE)
    expect(frames.size).toBe(1)

    flushFrames()
    expect(heightPx()).toBe(6 * LINE)
  })

  it("a deletion collapses and remeasures, back down to the `rows` floor", () => {
    render(<TextArea aria-label="notes" rows={4} />)
    edit(lines(6))
    flushFrames()
    expect(heightPx()).toBe(6 * LINE)

    edit(lines(5), "deleteContentBackward")
    flushFrames()
    expect(heightPx()).toBe(5 * LINE)

    edit(lines(2), "deleteByCut")
    flushFrames()
    expect(heightPx()).toBe(4 * LINE)
  })

  it("a shorter replacement that is not a deletion also remeasures", () => {
    render(<TextArea aria-label="notes" rows={2} />)
    edit(lines(6))
    flushFrames()
    expect(heightPx()).toBe(6 * LINE)

    edit("x", "insertFromPaste")
    flushFrames()
    expect(heightPx()).toBe(2 * LINE)
  })

  it("an edit that adds a line grows in place and never collapses the box first", () => {
    render(<TextArea aria-label="notes" rows={2} />)
    edit(lines(6))
    flushFrames()
    //a collapse to `auto` is a forced reflow per keystroke, which is why growth
    //skips it: record every height write on the way through
    const writes: string[] = []
    const style = textarea().style
    const { get, set } = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(style),
      "height",
    ) as PropertyDescriptor
    Object.defineProperty(style, "height", {
      configurable: true,
      get() {
        return get?.call(style)
      },
      set(value: string) {
        writes.push(value)
        set?.call(style, value)
      },
    })

    edit(lines(7))
    flushFrames()
    expect(heightPx()).toBe(7 * LINE)
    expect(writes).toEqual(["8.75rem"])
  })

  it("`rows` defaults to 4", () => {
    render(<TextArea aria-label="notes" />)
    expect(heightPx()).toBe(4 * LINE)
  })

  it("an empty field sits at the `rows` floor even when its placeholder wraps past it", () => {
    //WebKit reads the placeholder into an empty field's scrollHeight: at a
    //narrow width or a large font a long placeholder measures taller than
    //`rows`, and the box must not follow it (measured on the iPhone 13 project
    //at a 200% root font, 2026-09-21: the empty field grew to the cap, and the
    //next fill, longer than nothing, never remeasured down from it)
    placeholderLines = 6
    render(
      <TextArea
        aria-label="notes"
        rows={2}
        maxRows={5}
        placeholder="a placeholder long enough to wrap six times"
      />,
    )
    expect(heightPx()).toBe(2 * LINE)
    expect(hasOverflowLock()).toBe(false)

    edit(lines(3))
    flushFrames()
    expect(heightPx()).toBe(3 * LINE)

    edit("", "deleteContentBackward")
    flushFrames()
    expect(heightPx(), "cleared: back at the floor").toBe(2 * LINE)
    expect(hasOverflowLock()).toBe(false)

    //a refill after the clear measures the text, not the placeholder
    edit(lines(3))
    flushFrames()
    expect(heightPx()).toBe(3 * LINE)
  })
})

describe("TextArea autoResize — the maxRows cap", () => {
  beforeEach(installFakeLayout)

  it("stops at maxRows, scrolls inside, and mirrors the shell's bottom padding as scroll inset", () => {
    layout.shellPadding = [8, 12]
    render(<TextArea aria-label="notes" rows={2} maxRows={5} />)
    expect(hasOverflowLock()).toBe(false)
    expect(isScrollPadded()).toBe(false)

    edit(lines(10))
    flushFrames()
    expect(heightPx()).toBe(5 * LINE)
    expect(hasOverflowLock()).toBe(true)
    expect(
      textarea().style.getPropertyValue("scroll-padding-bottom"),
    ).toBe("12px")
    //only the bottom inset is mirrored
    expect(textarea().style.getPropertyValue("scroll-padding-top")).toBe(
      "0px",
    )
  })

  it("more text at the cap keeps the cap and the scroll inset", () => {
    layout.shellPadding = [0, 12]
    render(<TextArea aria-label="notes" rows={2} maxRows={5} />)
    edit(lines(10))
    flushFrames()
    edit(lines(14))
    flushFrames()
    expect(heightPx()).toBe(5 * LINE)
    expect(hasOverflowLock()).toBe(true)
    expect(isScrollPadded()).toBe(true)
  })

  it("dropping back under the cap removes the scroll inset and the overflow", () => {
    layout.shellPadding = [0, 12]
    render(<TextArea aria-label="notes" rows={2} maxRows={5} />)
    edit(lines(10))
    flushFrames()
    edit(lines(3), "deleteContentBackward")
    flushFrames()
    expect(heightPx()).toBe(3 * LINE)
    expect(hasOverflowLock()).toBe(false)
    expect(isScrollPadded()).toBe(false)
  })

  it("maxRows defaults to 100", () => {
    render(<TextArea aria-label="notes" rows={1} />)
    edit(lines(100))
    flushFrames()
    expect(heightPx()).toBe(100 * LINE)
    expect(hasOverflowLock()).toBe(false)

    edit(lines(101))
    flushFrames()
    expect(heightPx()).toBe(100 * LINE)
    expect(hasOverflowLock()).toBe(true)
  })

  it("a new maxRows applies on the next sync without waiting for a resize", () => {
    const { rerender } = render(
      <TextArea aria-label="notes" rows={2} maxRows={20} />,
    )
    edit(lines(10))
    flushFrames()
    expect(heightPx()).toBe(10 * LINE)

    rerender(<TextArea aria-label="notes" rows={2} maxRows={5} />)
    expect(heightPx()).toBe(5 * LINE)
    expect(hasOverflowLock()).toBe(true)
  })

  it("a new rows floor applies on the next sync without waiting for a resize", () => {
    const { rerender } = render(<TextArea aria-label="notes" rows={2} />)
    expect(heightPx()).toBe(2 * LINE)
    rerender(<TextArea aria-label="notes" rows={6} />)
    expect(heightPx()).toBe(6 * LINE)
  })
})

describe("TextArea autoResize — CSS and parent caps", () => {
  beforeEach(installFakeLayout)

  it("a max-height on the shell caps the field at that height minus the shell's padding and border", () => {
    layout.shellPadding = [10, 10]
    layout.shellBorder = [2, 2]
    layout.shellMaxHeight = "124px"
    render(<TextArea aria-label="notes" rows={2} />)
    edit(lines(10))
    flushFrames()
    expect(heightPx()).toBe(100)
    expect(hasOverflowLock()).toBe(true)
  })

  it("a shell max-height that the chrome alone fills is ignored", () => {
    layout.shellPadding = [10, 10]
    layout.shellMaxHeight = "20px"
    render(<TextArea aria-label="notes" rows={2} maxRows={8} />)
    edit(lines(10))
    flushFrames()
    expect(heightPx()).toBe(8 * LINE)
  })

  it("the tighter of maxRows and the shell max-height wins", () => {
    layout.shellMaxHeight = "300px"
    render(<TextArea aria-label="notes" rows={2} maxRows={5} />)
    edit(lines(10))
    flushFrames()
    expect(heightPx()).toBe(5 * LINE)
  })

  it("a parent max-height caps the field to the whole rows that fit below the shell's offset", () => {
    layout.shellPadding = [12, 12]
    layout.shellTopInParent = 10
    //150 - 10 offset - 24 chrome = 116px, which is 5 whole 20px rows
    layout.parentMaxHeight = "150px"
    render(<TextArea aria-label="notes" rows={2} />)
    edit(lines(10))
    flushFrames()
    expect(heightPx()).toBe(5 * LINE)
    expect(hasOverflowLock()).toBe(true)
  })

  it.each([
    ["the shell starts below it", { shellTopInParent: 200 }],
    [
      "the chrome alone fills it",
      { shellPadding: [80, 80] as [number, number] },
    ],
  ])("a parent max-height is ignored when %s", (_, patch) => {
    Object.assign(layout, { parentMaxHeight: "150px" }, patch)
    render(<TextArea aria-label="notes" rows={1} maxRows={12} />)
    edit(lines(20))
    flushFrames()
    expect(heightPx()).toBe(12 * LINE)
  })

  it("caps are read once and re-read after a resize", () => {
    render(<TextArea aria-label="notes" rows={2} />)
    edit(lines(10))
    flushFrames()
    expect(heightPx()).toBe(10 * LINE)

    //a style change alone is not seen: the caps are cached until layout moves
    layout.shellMaxHeight = "100px"
    edit(lines(11))
    flushFrames()
    expect(heightPx()).toBe(11 * LINE)

    for (const observer of observers) observer.notify()
    flushFrames()
    expect(heightPx()).toBe(100)
    expect(hasOverflowLock()).toBe(true)
  })
})

describe("TextArea autoResize — scheduling", () => {
  beforeEach(installFakeLayout)

  it("observes the shell and its parent", () => {
    const { container } = render(<TextArea aria-label="notes" />)
    expect(observers).toHaveLength(1)
    expect([...(observers[0]?.observed ?? [])]).toEqual([
      shell(),
      container,
    ])
  })

  it("coalesces edits and resizes before a frame into one sync", () => {
    render(<TextArea aria-label="notes" rows={2} />)
    edit(lines(3))
    edit(lines(4))
    observers[0]?.notify()
    expect(frames.size).toBe(1)
    flushFrames()
    expect(heightPx()).toBe(4 * LINE)
  })

  it("a deletion's remeasure survives a later resize in the same frame", () => {
    render(<TextArea aria-label="notes" rows={2} />)
    edit(lines(6))
    flushFrames()

    edit(lines(2), "deleteContentBackward")
    //the resize schedules without asking for a remeasure; it must not cancel one
    observers[0]?.notify()
    flushFrames()
    expect(heightPx()).toBe(2 * LINE)
  })

  it("unmounting cancels a pending frame and disconnects the observer", () => {
    const { unmount } = render(<TextArea aria-label="notes" />)
    edit(lines(6))
    expect(frames.size).toBe(1)
    unmount()
    expect(frames.size).toBe(0)
    expect(observers[0]?.disconnected).toBe(true)
  })
})

describe("TextArea autoResize — controlled", () => {
  beforeEach(installFakeLayout)

  it("follows the value prop in the same commit, with no frame", () => {
    const { rerender } = render(
      <TextArea
        aria-label="notes"
        rows={2}
        value=""
        onChange={() => {}}
      />,
    )
    rerender(
      <TextArea
        aria-label="notes"
        rows={2}
        value={lines(6)}
        onChange={() => {}}
      />,
    )
    expect(frames.size).toBe(0)
    expect(heightPx()).toBe(6 * LINE)
  })

  it("a shorter value from the parent collapses and remeasures", () => {
    const { rerender } = render(
      <TextArea
        aria-label="notes"
        rows={2}
        value={lines(6)}
        onChange={() => {}}
      />,
    )
    expect(heightPx()).toBe(6 * LINE)
    rerender(
      <TextArea
        aria-label="notes"
        rows={2}
        value={lines(3)}
        onChange={() => {}}
      />,
    )
    expect(heightPx()).toBe(3 * LINE)
  })

  it("the input event schedules nothing: the value prop is the trigger", () => {
    const onInput = vi.fn()
    render(
      <TextArea
        aria-label="notes"
        value="a"
        onChange={() => {}}
        onInput={onInput}
      />,
    )
    edit(lines(6))
    expect(onInput).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
  })

  it("an uncontrolled field still hands the input event to the consumer", () => {
    const onInput = vi.fn()
    render(<TextArea aria-label="notes" onInput={onInput} />)
    edit("a")
    expect(onInput).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(1)
  })
})

describe("TextArea autoResize={false} — fill mode", () => {
  beforeEach(installFakeLayout)

  it("lays the shell out as a column that fills its box, with the field scrolling inside", () => {
    render(
      <TextArea
        aria-label="notes"
        autoResize={false}
        className="consumer-notes"
        style={{ flex: "none", minHeight: "40px", letterSpacing: "1px" }}
      />,
    )
    //the consumer's class lands untouched and alone: adaptv adds none of its own
    expect(shell().className).toBe("consumer-notes")
    expect(textarea().hasAttribute("class")).toBe(false)
    //locked inline: neither a consumer class nor a consumer style reshapes it
    expect(shell().style.display).toBe("flex")
    expect(shell().style.height).toBe("100%")
    expect(shell().style.minHeight).toMatch(/^0(px)?$/)
    expect(shell().style.flexDirection).toBe("column")
    //the consumer's style reaches the field and loses only where the lock is
    expect(textarea().style.letterSpacing).toBe("1px")
    expect(textarea().style.flex).toMatch(/^1( 1 0%)?$/)
    expect(textarea().style.minHeight).toMatch(/^0(px)?$/)
    expect(hasOverflowLock()).toBe(true)
  })

  it("renders a one-row field too: the shell's box, not `rows`, sets the height", () => {
    render(<TextArea aria-label="notes" autoResize={false} rows={6} />)
    expect(textarea().getAttribute("rows")).toBe("1")
  })

  it("observes only the shell: the parent does not size a filling field", () => {
    render(<TextArea aria-label="notes" autoResize={false} />)
    expect([...(observers[0]?.observed ?? [])]).toEqual([shell()])
  })

  it("never writes a height, and clears one left by grow mode", () => {
    layout.autoBoxHeight = 4 * LINE
    const { rerender } = render(<TextArea aria-label="notes" rows={6} />)
    expect(textarea().style.height).not.toBe("")

    rerender(<TextArea aria-label="notes" rows={6} autoResize={false} />)
    expect(textarea().style.height).toBe("")
    //…and only the height: the fill lock React wrote inline (`min-height: 0`,
    //`overflow-y: auto`) is not the engine's to strip, or the field stops
    //scrolling inside itself the moment it syncs
    expect(textarea().style.minHeight).toMatch(/^0(px)?$/)
    expect(textarea().style.overflowY).toBe("auto")
  })

  it("overflowing content gets the shell's bottom padding as scroll inset, and an unfocused field scrolls back to the top", () => {
    layout.autoBoxHeight = 4 * LINE
    layout.shellPadding = [0, 16]
    render(
      <TextArea
        aria-label="notes"
        autoResize={false}
        defaultValue={lines(10)}
      />,
    )
    expect(
      textarea().style.getPropertyValue("scroll-padding-bottom"),
    ).toBe("16px")

    textarea().scrollTop = 50
    observers[0]?.notify()
    flushFrames()
    expect(textarea().scrollTop).toBe(0)
  })

  it("a focused field keeps its scroll position, so the caret stays in view", () => {
    layout.autoBoxHeight = 4 * LINE
    render(
      <TextArea
        aria-label="notes"
        autoResize={false}
        defaultValue={lines(10)}
      />,
    )
    textarea().focus()
    textarea().scrollTop = 50
    observers[0]?.notify()
    flushFrames()
    expect(textarea().scrollTop).toBe(50)
  })

  it("content that fits has no scroll inset, and loses it once it fits again", () => {
    layout.autoBoxHeight = 4 * LINE
    layout.shellPadding = [0, 16]
    render(<TextArea aria-label="notes" autoResize={false} />)
    expect(isScrollPadded()).toBe(false)

    edit(lines(10))
    flushFrames()
    expect(isScrollPadded()).toBe(true)

    edit(lines(2), "deleteContentBackward")
    flushFrames()
    expect(isScrollPadded()).toBe(false)
  })
})
