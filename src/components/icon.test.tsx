import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act, render } from "@testing-library/react"
import type { ReactElement, ReactNode, Ref, SVGProps } from "react"
import {
  createRef,
  forwardRef,
  memo,
  StrictMode,
  Suspense,
  startTransition,
  useLayoutEffect,
  useState,
} from "react"
import { renderToString } from "react-dom/server"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { Icon } from "#adaptv/components/icon"
import { measureDynamicTypeScale } from "#adaptv/utils/text-scale"
import { resetWarnOnce } from "#adaptv/utils/warn-once"

//The scalar is an ambient iOS-WebKit measurement (covered on its own in
//`utils/text-scale.test.ts`); mocked so the COMPONENT's wiring is deterministic —
//the same seam `text.test.tsx` uses, because Icon reuses the same measurement.
vi.mock("#adaptv/utils/text-scale", () => ({
  measureDynamicTypeScale: vi.fn(() => 1),
}))
const mockedScale = vi.mocked(measureDynamicTypeScale)

//the development warnings are once per message for the module's life; every case
//starts unwarned
beforeEach(() => {
  resetWarnOnce()
})

/** A stand-in for an icon-set component: an `<svg>` behind `forwardRef`, like lucide's. */
const Glyph = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function Glyph(props, ref) {
    return (
      //biome-ignore lint/a11y/noSvgWithoutTitle: exposure is what Icon adds — the glyph is deliberately bare, like an icon set's
      <svg ref={ref} viewBox="0 0 24 24" {...props}>
        <path d="M0 0h24v24H0z" />
      </svg>
    )
  },
)

/** A second glyph TYPE, for swapping the element Icon renders. */
const OtherGlyph = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function OtherGlyph(props, ref) {
    return (
      //biome-ignore lint/a11y/noSvgWithoutTitle: exposure is what Icon adds — the glyph is deliberately bare, like an icon set's
      <svg ref={ref} viewBox="0 0 16 16" data-glyph="other" {...props}>
        <path d="M0 0h16v16H0z" />
      </svg>
    )
  },
)

function firstEl(ui: ReactElement): SVGSVGElement {
  const { container } = render(ui)
  return container.firstElementChild as SVGSVGElement
}

describe("Icon renders the element it is given", () => {
  it("adds no wrapper node — the svg IS the root", () => {
    const { container } = render(<Icon render={<Glyph />} />)
    expect(container.childElementCount).toBe(1)
    expect(container.firstElementChild?.tagName.toLowerCase()).toBe("svg")
    expect(container.querySelector("path")).not.toBeNull()
  })

  it("carries the scope attribute for import-free global styling", () => {
    expect(
      firstEl(<Icon render={<Glyph />} />).getAttribute("data-adaptv"),
    ).toBe("icon")
  })

  it("keeps the element's own props", () => {
    const el = firstEl(
      <Icon render={<Glyph data-testid="own" stroke="red" />} />,
    )
    expect(el.getAttribute("data-testid")).toBe("own")
    expect(el.getAttribute("stroke")).toBe("red")
    expect(el.getAttribute("viewBox")).toBe("0 0 24 24")
  })

  it("forwards native svg props of its own", () => {
    const el = firstEl(<Icon render={<Glyph />} id="x" />)
    expect(el.id).toBe("x")
  })

  it("keeps the element's own ref when Icon is given none", () => {
    const own = createRef<SVGSVGElement>()
    const el = firstEl(<Icon render={<Glyph ref={own} />} />)
    expect(own.current).toBe(el)
  })

  it("feeds BOTH refs when Icon is given one too", () => {
    const own = createRef<SVGSVGElement>()
    const outer = createRef<SVGSVGElement>()
    const el = firstEl(<Icon ref={outer} render={<Glyph ref={own} />} />)
    expect(outer.current).toBe(el)
    expect(own.current).toBe(el)
  })

  it("runs React 19 callback-ref cleanups instead of calling the refs with null", () => {
    const log: string[] = []
    const tracked =
      (tag: string): Ref<SVGSVGElement> =>
      (node) => {
        log.push(`${tag}:${node ? "node" : "null"}`)
        return () => {
          log.push(`${tag}:cleanup`)
        }
      }
    const { unmount } = render(
      <Icon
        ref={tracked("icon")}
        scaleWithSystem
        render={<Glyph ref={tracked("own")} />}
      />,
    )
    unmount()
    expect(log).toEqual([
      "icon:node",
      "own:node",
      "icon:cleanup",
      "own:cleanup",
    ])
  })

  it("feeds the element's ref and Icon's under scaleWithSystem as well", () => {
    //the opt-in adds a THIRD ref (the measurement); neither consumer ref may lose
    const own = createRef<SVGSVGElement>()
    const calls: Array<SVGSVGElement | null> = []
    const outer: Ref<SVGSVGElement> = (node) => {
      calls.push(node)
    }
    const el = firstEl(
      <Icon ref={outer} scaleWithSystem render={<Glyph ref={own} />} />,
    )
    expect(own.current).toBe(el)
    expect(calls).toContain(el)
  })
})

/* =============================================================================
 * EXPOSURE — decorative vs meaningful
 * ============================================================================= */

describe("Icon without a label is decorative", () => {
  it("is aria-hidden, with no role and no name", () => {
    const el = firstEl(<Icon render={<Glyph />} />)
    expect(el.getAttribute("aria-hidden")).toBe("true")
    expect(el.hasAttribute("role")).toBe(false)
    expect(el.hasAttribute("aria-label")).toBe(false)
  })

  it("uses aria-hidden, never role=none/presentation (a named svg survives those)", () => {
    const el = firstEl(<Icon render={<Glyph />} />)
    expect(el.getAttribute("role")).not.toBe("none")
    expect(el.getAttribute("role")).not.toBe("presentation")
  })

  describe("with an exposure attribute on the element itself", () => {
    let error: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      error = vi.spyOn(console, "error").mockImplementation(() => {})
    })
    afterEach(() => {
      error.mockRestore()
    })

    it("owns exposure: the element's own role and name do not leak through", () => {
      //`aria-hidden` next to a name is a contradiction the tree resolves per engine;
      //`label` is the one channel
      const el = firstEl(
        <Icon render={<Glyph role="img" aria-label="Back" />} />,
      )
      expect(el.getAttribute("aria-hidden")).toBe("true")
      expect(el.hasAttribute("role")).toBe(false)
      expect(el.hasAttribute("aria-label")).toBe(false)
    })

    it("teaches in development instead of dropping the name in silence", () => {
      render(<Icon render={<Glyph aria-label="Back" />} />)
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]?.[0])).toContain("label")
    })

    it("reports an aria-labelledby on the element as a dropped name", () => {
      const el = firstEl(
        <Icon render={<Glyph aria-labelledby="elsewhere" />} />,
      )
      expect(el.hasAttribute("aria-labelledby")).toBe(false)
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]?.[0])).toContain("aria-labelledby")
    })

    it("does not report an aria-hidden the element carried: it agrees", () => {
      render(<Icon render={<Glyph aria-hidden="true" />} />)
      expect(error).not.toHaveBeenCalled()
    })

    it("reports a tabIndex that would put keyboard focus on the hidden node", () => {
      render(<Icon render={<Glyph />} tabIndex={0} />)
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]?.[0])).toContain("tabIndex")
      error.mockClear()
      resetWarnOnce()
      //…from the element too
      render(<Icon render={<Glyph tabIndex={0} />} />)
      expect(error).toHaveBeenCalledTimes(1)
    })

    it("warns once per message, not once per icon", () => {
      render(
        <StrictMode>
          <Icon render={<Glyph aria-label="One" />} />
          <Icon render={<Glyph aria-label="Two" />} />
          <Icon render={<Glyph aria-label="Three" />} />
        </StrictMode>,
      )
      expect(error).toHaveBeenCalledTimes(1)
      //a different message still gets its own line
      render(<Icon render={<Glyph />} tabIndex={0} />)
      expect(error).toHaveBeenCalledTimes(2)
    })

    it("stays quiet for a tabIndex Tab never reaches, or on a labelled icon", () => {
      render(<Icon render={<Glyph />} tabIndex={-1} />)
      render(<Icon render={<Glyph />} tabIndex={0} label="Back" />)
      expect(error).not.toHaveBeenCalled()
    })
  })
})

describe("Icon with a label is meaningful", () => {
  it("is role=img with the label as its name", () => {
    const el = firstEl(<Icon render={<Glyph />} label="Back" />)
    expect(el.getAttribute("role")).toBe("img")
    expect(el.getAttribute("aria-label")).toBe("Back")
  })

  it("is not hidden", () => {
    const el = firstEl(<Icon render={<Glyph />} label="Back" />)
    expect(el.hasAttribute("aria-hidden")).toBe(false)
  })

  it("an empty label is no label — decorative, not an unnamed image", () => {
    const el = firstEl(<Icon render={<Glyph />} label="" />)
    expect(el.getAttribute("aria-hidden")).toBe("true")
    expect(el.hasAttribute("role")).toBe(false)
  })

  it("a blank label is no label either", () => {
    const el = firstEl(<Icon render={<Glyph />} label="   " />)
    expect(el.getAttribute("aria-hidden")).toBe("true")
    expect(el.hasAttribute("role")).toBe(false)
    expect(el.hasAttribute("aria-label")).toBe(false)
  })

  describe("in development", () => {
    let error: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      error = vi.spyOn(console, "error").mockImplementation(() => {})
    })
    afterEach(() => {
      error.mockRestore()
    })

    it("reports an aria-hidden the element carried, which the label contradicts", () => {
      const el = firstEl(
        <Icon render={<Glyph aria-hidden="true" />} label="Back" />,
      )
      expect(el.hasAttribute("aria-hidden")).toBe(false)
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]?.[0])).toContain("aria-hidden")
    })

    it("reports a <title> inside a labelled svg: it would be read as a description", () => {
      render(
        <Icon
          label="Sync failed"
          render={
            <svg>
              <title>Alert triangle</title>
            </svg>
          }
        />,
      )
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]?.[0])).toContain("<title>")
    })

    it("stays quiet for a <title> inside a decorative svg: aria-hidden hides it too", () => {
      render(
        <Icon
          render={
            <svg>
              <title>Alert triangle</title>
            </svg>
          }
        />,
      )
      expect(error).not.toHaveBeenCalled()
    })
  })

  it("the label beats an aria-labelledby the element carried", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      //labelledby outranks aria-label in name computation, so leaving it would make
      //`label` silently lose
      const el = firstEl(
        <Icon
          render={<Glyph aria-labelledby="elsewhere" />}
          label="Back"
        />,
      )
      expect(el.hasAttribute("aria-labelledby")).toBe(false)
      expect(el.getAttribute("aria-label")).toBe("Back")
    } finally {
      error.mockRestore()
    }
  })

  it("server-renders the same exposure the client does", () => {
    const html = renderToString(<Icon render={<Glyph />} label="Back" />)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Back"')
    expect(html).not.toContain("aria-hidden")
    const decorative = renderToString(<Icon render={<Glyph />} />)
    expect(decorative).toContain('aria-hidden="true"')
  })
})

/* =============================================================================
 * SIZE & PRECEDENCE
 * ============================================================================= */

describe("Icon style precedence", () => {
  const css = readFileSync(
    resolve(__dirname, "../styles/icon.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "")

  it("sizes to the font by default (1em, both axes) and never shrinks in a row — as a layer rule", () => {
    expect(css).toContain("@layer adaptv.components")
    const rule = css.slice(css.indexOf(':where([data-adaptv="icon"])'))
    expect(rule).toMatch(/width:\s*1em;/)
    expect(rule).toMatch(/height:\s*1em;/)
    expect(rule).toMatch(/flex-shrink:\s*0;/)
    expect(css).not.toContain("!important")
    //longhands, never a shorthand that would tie both axes together
    expect(css).not.toMatch(/\binline-size|block-size|\bsize\s*:/)
  })

  it("writes no class of its own, and names its part", () => {
    const el = firstEl(<Icon render={<Glyph />} />)
    expect(el.hasAttribute("class")).toBe(false)
    expect(el.getAttribute("data-part")).toBe("root")
    //and no inline size: the 1em default must stay beatable by any class
    expect(el.getAttribute("style")).toBeNull()
  })

  it("keeps a data-part the svg already carries", () => {
    const el = firstEl(<Icon render={<Glyph data-part="glyph" />} />)
    expect(el.getAttribute("data-part")).toBe("glyph")
  })

  it("a consumer size-* reaches the DOM untouched, with nothing of Icon's beside it", () => {
    const el = firstEl(<Icon render={<Glyph />} className="size-6" />)
    expect(el.getAttribute("class")).toBe("size-6")
  })

  it("a consumer w-* reaches the DOM untouched", () => {
    const el = firstEl(<Icon render={<Glyph />} className="w-6" />)
    expect(el.getAttribute("class")).toBe("w-6")
  })

  it("joins the element's className and Icon's, the element's first, merging none", () => {
    //both are consumer classes; resolving a conflict between them is the consumer's
    //tool's job, not adaptv's (docs/decisions/styling.md §0.1)
    const el = firstEl(
      <Icon
        render={<Glyph className="size-4 text-red-500" />}
        className="size-8"
      />,
    )
    expect(el.getAttribute("class")).toBe("size-4 text-red-500 size-8")
  })

  it("the element's className alone reaches the DOM", () => {
    const el = firstEl(<Icon render={<Glyph className="size-4" />} />)
    expect(el.getAttribute("class")).toBe("size-4")
  })

  it("merges the element's style with Icon's, Icon's winning per property", () => {
    const el = firstEl(
      <Icon
        render={<Glyph style={{ color: "red", opacity: "0.5" }} />}
        style={{ color: "blue" }}
      />,
    )
    expect(el.style.color).toBe("blue")
    expect(el.style.opacity).toBe("0.5")
  })
})

/* =============================================================================
 * DYNAMIC TYPE — scaleWithSystem
 * ============================================================================= */

describe("Icon scaleWithSystem", () => {
  beforeEach(() => {
    mockedScale.mockReturnValue(1)
  })

  it("is off by default — the presence attribute is absent", () => {
    expect(
      firstEl(<Icon render={<Glyph />} />).hasAttribute(
        "data-scale-with-system",
      ),
    ).toBe(false)
  })

  it("opting in stamps the presence attribute as an empty string", () => {
    expect(
      firstEl(<Icon render={<Glyph />} scaleWithSystem />).getAttribute(
        "data-scale-with-system",
      ),
    ).toBe("")
  })

  it("never asks for the factor unless opted in", () => {
    mockedScale.mockClear()
    render(<Icon render={<Glyph />} style={{ width: "10px" }} />)
    expect(mockedScale).not.toHaveBeenCalled()
  })

  it("writes NOTHING at factor 1 — not even the size it already has", () => {
    //a spy on the setters, not a read: at factor 1 a write of the built size back onto
    //the element would read exactly like no write at all
    const declaration = Object.getPrototypeOf(document.body.style)
    const width = vi.spyOn(declaration, "width", "set")
    const height = vi.spyOn(declaration, "height", "set")
    try {
      const { rerender } = render(
        <Icon render={<Glyph />} scaleWithSystem className="size-5" />,
      )
      rerender(
        <Icon render={<Glyph />} scaleWithSystem className="size-6" />,
      )
      expect(mockedScale).toHaveBeenCalled()
      expect(width).not.toHaveBeenCalled()
      expect(height).not.toHaveBeenCalled()
    } finally {
      width.mockRestore()
      height.mockRestore()
    }
  })

  it("MULTIPLIES the built width and height by the factor, never replaces them", () => {
    mockedScale.mockReturnValue(2)
    const el = firstEl(
      <Icon
        render={<Glyph />}
        scaleWithSystem
        style={{ width: "10px", height: "12px" }}
      />,
    )
    expect(el.style.width).toBe("20px")
    expect(el.style.height).toBe("24px")
  })

  it("re-measures from the built size, not from its own last answer", () => {
    mockedScale.mockReturnValue(2)
    const { container, rerender } = render(
      <Icon
        render={<Glyph />}
        scaleWithSystem
        style={{ width: "10px", height: "10px" }}
      />,
    )
    rerender(
      <Icon
        render={<Glyph />}
        scaleWithSystem
        style={{ width: "16px", height: "16px" }}
      />,
    )
    const el = container.firstElementChild as SVGSVGElement
    expect(el.style.width).toBe("32px")
  })

  it("opting back out restores the built size", () => {
    mockedScale.mockReturnValue(2)
    const { container, rerender } = render(
      <Icon
        render={<Glyph />}
        scaleWithSystem
        style={{ width: "10px", height: "10px" }}
      />,
    )
    rerender(
      <Icon
        render={<Glyph />}
        style={{ width: "10px", height: "10px" }}
      />,
    )
    const el = container.firstElementChild as SVGSVGElement
    expect(el.style.width).toBe("10px")
    expect(el.hasAttribute("data-scale-with-system")).toBe(false)
  })

  it("is scaled before any layout effect after it reads the box", () => {
    //a sibling that measures in its own layout effect — a popover anchoring to the icon,
    //say — runs after Icon's and must see the scaled size, not the built one
    mockedScale.mockReturnValue(2)
    let seen = ""
    function Reader() {
      useLayoutEffect(() => {
        seen = document.querySelector("svg")?.style.width ?? "missing"
      }, [])
      return null
    }
    render(
      <>
        <Icon
          render={<Glyph />}
          scaleWithSystem
          style={{ width: "10px", height: "10px" }}
        />
        <Reader />
      </>,
    )
    expect(seen).toBe("20px")
  })

  it("is inert on the server: no inline size in the SSR markup", () => {
    mockedScale.mockReturnValue(2)
    const html = renderToString(
      <Icon render={<Glyph />} scaleWithSystem />,
    )
    expect(html).not.toContain("width:")
    expect(html).toContain('data-scale-with-system=""')
  })
})

/*
 * The factors iOS really produces are whole-number fractions of 17 (19/17, 23/17, 28/17,
 * 53/17…), and an engine stores such a length ROUNDED — happy-dom and WebKit to six
 * decimals, Chromium to four. Every case here runs at 28/17 with CLASS sizing, the
 * shape a device renders, because a factor of 2 on an inline box reads back exactly and
 * hides anything that compares its own write.
 */
describe("Icon scaleWithSystem at a factor the engine rounds", () => {
  const factor = 28 / 17
  let sheet: HTMLStyleElement

  beforeAll(() => {
    sheet = document.createElement("style")
    sheet.textContent =
      ".size-5{width:20px;height:20px}.size-6{width:24px;height:24px}"
    document.head.append(sheet)
  })
  afterAll(() => {
    sheet.remove()
  })
  beforeEach(() => {
    mockedScale.mockReturnValue(factor)
  })
  afterEach(() => {
    mockedScale.mockReturnValue(1)
  })

  const px = (value: string) => Number.parseFloat(value)
  const scaled = (container: HTMLElement) =>
    container.querySelector("svg") as SVGSVGElement

  it("the premise: the length written reads back rounded", () => {
    const probe = document.createElement("div")
    probe.style.width = `${20 * factor}px`
    expect(probe.style.width).not.toBe(`${20 * factor}px`)
  })

  it("mounts under StrictMode at the built size × factor, not × factor²", () => {
    const { container } = render(
      <StrictMode>
        <Icon render={<Glyph />} scaleWithSystem className="size-5" />
      </StrictMode>,
    )
    const el = scaled(container)
    expect(px(el.style.width)).toBeCloseTo(20 * factor, 3)
    expect(px(el.style.height)).toBeCloseTo(20 * factor, 3)
  })

  it("re-measures a new className from the class size, and back again", () => {
    const { container, rerender } = render(
      <Icon render={<Glyph />} scaleWithSystem className="size-5" />,
    )
    rerender(
      <Icon render={<Glyph />} scaleWithSystem className="size-6" />,
    )
    expect(px(scaled(container).style.width)).toBeCloseTo(24 * factor, 3)
    rerender(
      <Icon render={<Glyph />} scaleWithSystem className="size-5" />,
    )
    expect(px(scaled(container).style.width)).toBeCloseTo(20 * factor, 3)
    expect(px(scaled(container).style.height)).toBeCloseTo(20 * factor, 3)
  })

  it("opting out leaves no inline size behind", () => {
    const { container, rerender } = render(
      <Icon render={<Glyph />} scaleWithSystem className="size-5" />,
    )
    expect(scaled(container).style.width).not.toBe("")
    rerender(<Icon render={<Glyph />} className="size-5" />)
    expect(scaled(container).style.width).toBe("")
    expect(scaled(container).style.height).toBe("")
  })

  it("scales a swapped glyph, which is a new node", () => {
    const { container, rerender } = render(
      <Icon render={<Glyph />} scaleWithSystem className="size-5" />,
    )
    rerender(
      <Icon render={<OtherGlyph />} scaleWithSystem className="size-5" />,
    )
    const el = scaled(container)
    expect(el.getAttribute("data-glyph")).toBe("other")
    expect(px(el.style.width)).toBeCloseTo(20 * factor, 3)
  })

  it("scales a glyph swapped by key alone", () => {
    const { container, rerender } = render(
      <Icon
        render={<Glyph key="a" />}
        scaleWithSystem
        className="size-5"
      />,
    )
    const before = scaled(container)
    rerender(
      <Icon
        render={<Glyph key="b" />}
        scaleWithSystem
        className="size-5"
      />,
    )
    const el = scaled(container)
    expect(el).not.toBe(before)
    expect(px(el.style.width)).toBeCloseTo(20 * factor, 3)
  })

  it("reveals the COMMITTED size after a Suspense fallback hid it mid-transition", async () => {
    //A transition renders a new width and suspends, so that render never commits — but
    //the ref it wrote during render is ahead of the DOM. An urgent suspend then shows
    //the fallback: React runs Icon's layout cleanup WITHOUT re-rendering it (the memo
    //holder bails out), and the cleanup restores that uncommitted width. When the
    //transition reverts, the reconnecting run must start from the committed size.
    const never = new Promise<void>(() => {})
    function Suspend(): ReactNode {
      throw never
    }
    const Holder = memo(function Holder({ width }: { width: string }) {
      return (
        <Icon
          render={<Glyph />}
          scaleWithSystem
          style={{ width, height: width }}
        />
      )
    })
    const set: {
      width?: (value: string) => void
      pending?: (value: boolean) => void
      urgent?: (value: boolean) => void
    } = {}
    function App() {
      const [width, setWidth] = useState("10px")
      const [pending, setPending] = useState(false)
      const [urgent, setUrgent] = useState(false)
      set.width = setWidth
      set.pending = setPending
      set.urgent = setUrgent
      return (
        <Suspense fallback={<p>fallback</p>}>
          <Holder width={width} />
          {pending && <Suspend />}
          {urgent && <Suspend />}
        </Suspense>
      )
    }
    const { container } = render(<App />)
    expect(px(scaled(container).style.width)).toBeCloseTo(10 * factor, 3)

    await act(async () => {
      startTransition(() => {
        set.width?.("16px")
        set.pending?.(true)
      })
    })
    await act(async () => {
      set.urgent?.(true)
    })
    await act(async () => {
      set.urgent?.(false)
    })
    await act(async () => {
      startTransition(() => {
        set.width?.("10px")
        set.pending?.(false)
      })
    })

    const el = scaled(container)
    expect(el.style.display).toBe("")
    expect(px(el.style.width)).toBeCloseTo(10 * factor, 3)
    expect(px(el.style.height)).toBeCloseTo(10 * factor, 3)
  })

  it("one render that changes the inline size AND opts out keeps the NEW size", () => {
    const { container, rerender } = render(
      <Icon
        render={<Glyph />}
        scaleWithSystem
        style={{ width: "10px", height: "10px" }}
      />,
    )
    rerender(
      <Icon
        render={<Glyph />}
        style={{ width: "16px", height: "16px" }}
      />,
    )
    expect(scaled(container).style.width).toBe("16px")
    expect(scaled(container).style.height).toBe("16px")
  })
})
