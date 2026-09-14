import { act, render } from "@testing-library/react"
import type { ReactElement } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ProgressBar, Spinner } from "#adaptv/components/spinner"
import { compileAdaptvStyles } from "#adaptv/styles/compile.test-helper"

/*
 * ProgressBar lives in Spinner's module and reuses its machinery, so this file asserts
 * the bar's own contract — ARIA per mode, clamping, the mode switch, the shared
 * observer, the announcement — and the COMPILED stylesheet for what happy-dom cannot
 * run (motion, reduced motion, RTL, forced colors). What the engines do with that CSS
 * is playground/e2e/progress-bar.spec.ts on chromium and webkit.
 */

/* =============================================================================
 * A controllable IntersectionObserver, as spinner.test.tsx has: the module keeps ONE
 * observer for the page, created on first use.
 * ============================================================================= */

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly targets = new Set<Element>()
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this)
  }
  observe(el: Element) {
    this.targets.add(el)
  }
  unobserve(el: Element) {
    this.targets.delete(el)
  }
  disconnect() {
    this.targets.clear()
  }
  takeRecords() {
    return []
  }
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver)

function intersect(el: Element, isIntersecting: boolean) {
  for (const observer of FakeIntersectionObserver.instances) {
    if (!observer.targets.has(el)) continue
    observer.callback(
      [{ target: el, isIntersecting } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    )
  }
}

function watched(el: Element): boolean {
  return FakeIntersectionObserver.instances.some((o) => o.targets.has(el))
}

function firstEl(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  return container.firstElementChild as HTMLElement
}

const ARIA_VALUES = ["aria-valuenow", "aria-valuemin", "aria-valuemax"]

/** The bar's exposure and mode, in one comparable object. */
function exposure(el: HTMLElement) {
  return {
    role: el.getAttribute("role"),
    name: el.getAttribute("aria-label"),
    hidden: el.getAttribute("aria-hidden"),
    now: el.getAttribute("aria-valuenow"),
    min: el.getAttribute("aria-valuemin"),
    max: el.getAttribute("aria-valuemax"),
    indeterminate: el.hasAttribute("data-progress-bar-indeterminate"),
    value: el.style.getPropertyValue("--progress-value") || null,
  }
}

/** Every rule in compiled CSS whose selector names the bar: selectors, body, media. */
function barRules(css: string) {
  return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .map((m) => ({ selector: m[1].trim(), body: m[2].trim() }))
    .filter((rule) =>
      rule.selector.includes('[data-adaptv="progress-bar"]'),
    )
}

/** The body of `@keyframes <name>` in compiled CSS, braces balanced. */
function keyframesBody(css: string, name: string): string | null {
  const start = css.indexOf(`@keyframes ${name} `)
  if (start === -1) return null
  let depth = 0
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++
    else if (css[i] === "}" && --depth === 0)
      return css.slice(start, i + 1)
  }
  return null
}

/** Every `@media <query>` block in compiled CSS, braces balanced. */
function mediaBlocks(css: string, query: string): string[] {
  const blocks: string[] = []
  let from = 0
  for (;;) {
    const start = css.indexOf(`@media ${query}`, from)
    if (start === -1) return blocks
    let depth = 0
    let end = -1
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++
      else if (css[i] === "}" && --depth === 0) {
        end = i + 1
        break
      }
    }
    if (end === -1) return blocks
    blocks.push(css.slice(start, end))
    from = end
  }
}

const INDICATOR = '[data-adaptv="progress-bar"] > [data-part="indicator"]'
const INDETERMINATE_INDICATOR =
  '[data-adaptv="progress-bar"][data-progress-bar-indeterminate] > [data-part="indicator"]'

/* =============================================================================
 * RENDER
 * ============================================================================= */

describe("ProgressBar renders", () => {
  it("a span carrying the scope attribute, with a track and an indicator inside", () => {
    const el = firstEl(<ProgressBar value={0.5} />)
    expect(el.tagName).toBe("SPAN")
    expect(el.getAttribute("data-adaptv")).toBe("progress-bar")
    expect(
      [...el.children].map((child) => [
        child.tagName,
        child.getAttribute("data-part"),
      ]),
    ).toEqual([
      ["SPAN", "track"],
      ["SPAN", "indicator"],
    ])
  })

  it("forwards native span props and the ref", () => {
    let node: HTMLSpanElement | null = null
    const el = firstEl(
      <ProgressBar
        id="p"
        data-testid="t"
        ref={(n) => {
          node = n
        }}
      />,
    )
    expect(el.id).toBe("p")
    expect(el.getAttribute("data-testid")).toBe("t")
    expect(node).toBe(el)
  })

  it("is exported through the public components barrel", async () => {
    const barrel = await import("#adaptv/interface/components.index")
    expect(barrel.ProgressBar).toBe(ProgressBar)
  })
})

/* =============================================================================
 * ARIA PER MODE
 * ============================================================================= */

describe("ProgressBar exposure", () => {
  it("determinate with a label: a progressbar with its name and a percentage", () => {
    expect(
      exposure(
        firstEl(<ProgressBar value={0.25} label="Uploading photo" />),
      ),
    ).toEqual({
      role: "progressbar",
      name: "Uploading photo",
      hidden: null,
      now: "25",
      min: "0",
      max: "100",
      indeterminate: false,
      value: "0.25",
    })
  })

  it("rounds the percentage it exposes, and keeps the exact fraction for the fill", () => {
    const el = firstEl(<ProgressBar value={1 / 3} label="Syncing" />)
    expect(el.getAttribute("aria-valuenow")).toBe("33")
    expect(
      Number(el.style.getPropertyValue("--progress-value")),
    ).toBeCloseTo(1 / 3)
  })

  it("indeterminate with a label: a progressbar with no value at all (ARIA's indeterminate)", () => {
    expect(
      exposure(firstEl(<ProgressBar label="Loading tasks" />)),
    ).toEqual({
      role: "progressbar",
      name: "Loading tasks",
      hidden: null,
      now: null,
      min: null,
      max: null,
      indeterminate: true,
      value: null,
    })
  })

  it("without a label it is decoration, as an unlabelled Spinner is — values included", () => {
    for (const ui of [
      <ProgressBar key="d" value={0.5} />,
      <ProgressBar key="i" />,
      <ProgressBar key="b" value={0.5} label="   " />,
    ]) {
      const el = firstEl(ui)
      expect(el.getAttribute("aria-hidden")).toBe("true")
      expect(el.hasAttribute("role")).toBe(false)
      expect(el.hasAttribute("aria-label")).toBe(false)
      for (const attribute of ARIA_VALUES)
        expect(el.hasAttribute(attribute)).toBe(false)
    }
  })

  it("a decorative determinate bar still draws its value", () => {
    const el = firstEl(<ProgressBar value={0.4} />)
    expect(el.style.getPropertyValue("--progress-value")).toBe("0.4")
    expect(el.hasAttribute("data-progress-bar-indeterminate")).toBe(false)
  })
})

/* =============================================================================
 * CLAMPING
 * ============================================================================= */

describe("ProgressBar clamps its value", () => {
  it("below 0 reads 0, above 1 reads 1 — in the fill and in what it exposes", () => {
    const low = firstEl(<ProgressBar value={-0.5} label="a" />)
    expect([
      low.getAttribute("aria-valuenow"),
      low.style.getPropertyValue("--progress-value"),
    ]).toEqual(["0", "0"])
    const high = firstEl(<ProgressBar value={1.5} label="b" />)
    expect([
      high.getAttribute("aria-valuenow"),
      high.style.getPropertyValue("--progress-value"),
    ]).toEqual(["100", "1"])
  })

  it("the edges are values, not indeterminate", () => {
    for (const value of [0, 1]) {
      const el = firstEl(<ProgressBar value={value} label="edge" />)
      expect(el.hasAttribute("data-progress-bar-indeterminate")).toBe(
        false,
      )
      expect(el.getAttribute("aria-valuenow")).toBe(String(value * 100))
    }
  })

  it("a value that is not a finite number is an unknown amount: indeterminate, never NaN", () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      const el = firstEl(<ProgressBar value={value} label="unknown" />)
      expect(exposure(el)).toMatchObject({
        role: "progressbar",
        now: null,
        min: null,
        max: null,
        indeterminate: true,
        value: null,
      })
      expect(el.outerHTML).not.toMatch(/NaN|Infinity/)
    }
  })

  it("a consumer style cannot desynchronise the fill from aria-valuenow", () => {
    const el = firstEl(
      <ProgressBar
        value={0.3}
        label="locked"
        style={{ ["--progress-value" as string]: 0.9, color: "red" }}
      />,
    )
    expect(el.style.getPropertyValue("--progress-value")).toBe("0.3")
    expect(el.style.color).toBe("red")
  })
})

/* =============================================================================
 * THE MODE SWITCH AND THE SHARED OBSERVER
 * ============================================================================= */

describe("ProgressBar off screen", () => {
  it("an indeterminate bar is watched by the SAME observer Spinner uses", () => {
    const { container } = render(
      <>
        <Spinner />
        <ProgressBar />
        <ProgressBar />
      </>,
    )
    const nodes = [...container.querySelectorAll("[data-adaptv]")]
    expect(nodes).toHaveLength(3)
    for (const el of nodes) expect(watched(el)).toBe(true)
    expect(FakeIntersectionObserver.instances).toHaveLength(1)
  })

  it("stamps its own attribute off screen — not the spinner's — and clears it on return", () => {
    const el = firstEl(<ProgressBar />)
    act(() => intersect(el, false))
    expect(el.hasAttribute("data-progress-bar-offscreen")).toBe(true)
    expect(el.hasAttribute("data-spinner-offscreen")).toBe(false)
    act(() => intersect(el, true))
    expect(el.hasAttribute("data-progress-bar-offscreen")).toBe(false)
  })

  it("a spinner beside it still gets the spinner's attribute from the same callback", () => {
    const { container } = render(
      <>
        <Spinner />
        <ProgressBar />
      </>,
    )
    const [spinner, bar] = [...container.querySelectorAll("[data-adaptv]")]
    act(() => {
      intersect(spinner, false)
      intersect(bar, false)
    })
    expect(spinner.hasAttribute("data-spinner-offscreen")).toBe(true)
    expect(spinner.hasAttribute("data-progress-bar-offscreen")).toBe(false)
    expect(bar.hasAttribute("data-progress-bar-offscreen")).toBe(true)
  })

  it("a determinate bar is not watched: at rest it has nothing to pause", () => {
    expect(watched(firstEl(<ProgressBar value={0.5} />))).toBe(false)
  })

  it("switching modes starts and stops the watch, and a stale stamp does not survive", () => {
    const { container, rerender } = render(
      <ProgressBar value={0.5} label="Upload" />,
    )
    const el = container.firstElementChild as HTMLElement
    expect(watched(el)).toBe(false)

    rerender(<ProgressBar label="Upload" />)
    expect(exposure(el)).toMatchObject({ indeterminate: true, now: null })
    expect(el.style.getPropertyValue("--progress-value")).toBe("")
    expect(watched(el)).toBe(true)
    act(() => intersect(el, false))
    expect(el.hasAttribute("data-progress-bar-offscreen")).toBe(true)

    rerender(<ProgressBar value={0.75} label="Upload" />)
    expect(exposure(el)).toMatchObject({ indeterminate: false, now: "75" })
    expect(watched(el)).toBe(false)
    expect(el.hasAttribute("data-progress-bar-offscreen")).toBe(false)
  })

  it("a record queued for a bar that stopped being watched stamps nothing", () => {
    const { container, rerender } = render(<ProgressBar />)
    const el = container.firstElementChild as HTMLElement
    const [observer] = FakeIntersectionObserver.instances
    rerender(<ProgressBar value={1} />)
    act(() =>
      observer.callback(
        [
          {
            target: el,
            isIntersecting: false,
          } as unknown as IntersectionObserverEntry,
        ],
        observer as unknown as IntersectionObserver,
      ),
    )
    expect(el.hasAttribute("data-progress-bar-offscreen")).toBe(false)
  })

  it("stops being watched when it unmounts", () => {
    const { container, unmount } = render(<ProgressBar />)
    const el = container.firstElementChild as HTMLElement
    expect(watched(el)).toBe(true)
    unmount()
    expect(watched(el)).toBe(false)
  })
})

/* =============================================================================
 * THE STYLESHEET — motion by transform, pause, reduced motion, RTL, forced colors
 * ============================================================================= */

describe("the bar moves by transform only", () => {
  it("the fill is scaleX of the value, and the only transition is on transform", async () => {
    const css = await compileAdaptvStyles([])
    const fill = barRules(css).filter(
      (rule) => rule.selector === INDICATOR,
    )
    expect(fill.length).toBeGreaterThan(0)
    expect(fill[0].body).toMatch(
      /transform: scaleX\(var\(--progress-value, 0\)\)/,
    )
    expect(fill[0].body).toMatch(/transition: transform [^;]*;/)
  })

  it("nothing on the bar animates or transitions a layout property", async () => {
    const css = await compileAdaptvStyles([])
    const rules = barRules(css)
    expect(rules.length).toBeGreaterThan(6)
    for (const { body } of rules) {
      //every transition names transform, or none
      for (const [, value] of body.matchAll(/transition: ([^;]*)/g))
        expect(value).toMatch(/^(transform \S+ \S+|none)$/)
      expect(body).not.toMatch(/transition-property/)
    }
    //the width is a mode, set once; it is never the thing that moves
    for (const name of [
      "adaptv-progress-bar-sweep",
      "adaptv-progress-bar-sweep-rtl",
    ]) {
      const frames = keyframesBody(css, name)
      expect(frames, name).not.toBeNull()
      const declared = [...(frames ?? "").matchAll(/([a-z-]+)\s*:/g)].map(
        (m) => m[1],
      )
      expect(new Set(declared), name).toEqual(new Set(["transform"]))
      expect(frames).toMatch(/translateX\(/)
    }
  })

  it("the sweep runs only where motion is welcome", async () => {
    const css = await compileAdaptvStyles([])
    const [welcome] = mediaBlocks(
      css,
      "(prefers-reduced-motion: no-preference)",
    )
    expect(welcome).toContain(
      `${INDETERMINATE_INDICATOR} {\n      animation: adaptv-progress-bar-sweep `,
    )
    //and nowhere outside that block
    expect(
      css
        .replace(welcome, "")
        .match(/animation: adaptv-progress-bar-sweep/g),
    ).toBeNull()
  })

  it("the parts are positioned from the inline start, and no !important is used", async () => {
    const css = await compileAdaptvStyles([])
    const parts = barRules(css).find(
      (rule) =>
        rule.selector === '[data-adaptv="progress-bar"] > [data-part]',
    )
    expect(parts?.body).toMatch(/inset-inline-start: 0/)
    expect(parts?.body).not.toMatch(/(^|[;\s])left:/)
    for (const { body } of barRules(css))
      expect(body).not.toContain("!important")
  })
})

describe("RTL", () => {
  it("under dir=rtl the fill grows from the right edge", async () => {
    const css = await compileAdaptvStyles([])
    const rule = barRules(css).find((r) =>
      r.selector.startsWith(`[dir="rtl"] ${INDICATOR}`),
    )
    expect(rule?.selector).toBe(
      `[dir="rtl"] ${INDICATOR}, [data-adaptv="progress-bar"][dir="rtl"] > [data-part="indicator"]`,
    )
    expect(rule?.body).toBe("transform-origin: right;")
    expect(
      barRules(css).find((r) => r.selector === INDICATOR)?.body,
    ).toMatch(/transform-origin: left;/)
  })

  it("under dir=rtl the sweep travels the other way, by name, so it does not reset the pause", async () => {
    const css = await compileAdaptvStyles([])
    const rule = barRules(css).find((r) =>
      r.selector.startsWith(`[dir="rtl"] ${INDETERMINATE_INDICATOR}`),
    )
    expect(rule?.body).toBe(
      "animation-name: adaptv-progress-bar-sweep-rtl;",
    )
    expect(keyframesBody(css, "adaptv-progress-bar-sweep")).toMatch(
      /from \{\s*transform: translateX\(-100%\);\s*\}\s*to \{\s*transform: translateX\(250%\);/,
    )
    expect(keyframesBody(css, "adaptv-progress-bar-sweep-rtl")).toMatch(
      /from \{\s*transform: translateX\(100%\);\s*\}\s*to \{\s*transform: translateX\(-250%\);/,
    )
  })
})

describe("the indeterminate bar pauses off screen", () => {
  it("the stamp pauses the indicator, with a selector that outranks every shorthand", async () => {
    const css = await compileAdaptvStyles([])
    const pause = barRules(css).filter((rule) =>
      rule.body.includes("animation-play-state"),
    )
    //three attributes on the box (0,4,0 with the part) beat the sweep's and the
    //pulse's two (0,3,0), whose `animation` shorthands reset the play state
    expect(pause).toEqual([
      {
        selector:
          '[data-adaptv="progress-bar"][data-progress-bar-indeterminate][data-progress-bar-offscreen] > [data-part="indicator"]',
        body: "animation-play-state: paused;",
      },
    ])
  })
})

describe("reduced motion", () => {
  it("the sweep becomes a full-width pulse with Spinner's own keyframes — never a stop", async () => {
    const css = await compileAdaptvStyles([])
    const ours = mediaBlocks(
      css,
      "(prefers-reduced-motion: reduce)",
    ).filter((block) => block.includes('[data-adaptv="progress-bar"]'))
    expect(ours).toHaveLength(1)
    const rules = barRules(ours[0])
    expect(rules).toEqual([
      { selector: INDICATOR, body: "transition: none;" },
      {
        selector: INDETERMINATE_INDICATOR,
        body: "width: 100%;\n      animation: adaptv-spinner-pulse 2s ease-in-out infinite;",
      },
    ])
    //and the pulse moves nothing across the screen
    expect(keyframesBody(css, "adaptv-spinner-pulse")).not.toMatch(
      /transform|translate|scale|width/,
    )
  })

  it("an indeterminate indicator carries no leftover scale, so the pulse is visible", async () => {
    const css = await compileAdaptvStyles([])
    const rule = barRules(css).find(
      (r) =>
        r.selector === INDETERMINATE_INDICATOR &&
        r.body.includes("width: 40%"),
    )
    expect(rule?.body).toMatch(/transform: none;/)
    expect(rule?.body).toMatch(/transition: none;/)
  })
})

describe("forced colors", () => {
  it("the indicator paints the system text colour itself, and the box gets an edge", async () => {
    const css = await compileAdaptvStyles([])
    const ours = mediaBlocks(css, "(forced-colors: active)").filter(
      (block) => block.includes('[data-adaptv="progress-bar"]'),
    )
    expect(ours).toHaveLength(1)
    expect(barRules(ours[0])).toEqual([
      {
        selector: '[data-adaptv="progress-bar"]',
        body: "outline: 1px solid;",
      },
      {
        selector: INDICATOR,
        body: "forced-color-adjust: none;\n      background-color: CanvasText;",
      },
    ])
    expect(
      barRules(css).find(
        (r) => r.selector === '[data-adaptv="progress-bar"] > [data-part]',
      )?.body,
    ).toMatch(/background-color: currentColor;/)
  })
})

/* =============================================================================
 * ANNOUNCEMENT — Spinner's, shared
 * ============================================================================= */

const announcerLines = () =>
  [
    ...document.querySelectorAll('[data-adaptv="spinner-announcer"] > *'),
  ].map((line) => line.textContent)

describe("a labelled bar is announced once, through Spinner's region", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    act(() => {
      vi.runAllTimers()
    })
    vi.useRealTimers()
  })

  it("its label is said once, and a value moving under it says nothing more", () => {
    const { rerender, unmount } = render(
      <ProgressBar value={0.1} label="Uploading photo" />,
    )
    act(() => {
      vi.advanceTimersByTime(200)
    })
    for (const value of [0.2, 0.5, 0.9, undefined, 1])
      rerender(<ProgressBar value={value} label="Uploading photo" />)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(announcerLines()).toEqual(["Uploading photo"])
    unmount()
  })

  it("a Spinner and a ProgressBar with the same label are one loading episode", () => {
    const { unmount } = render(
      <>
        <Spinner label="Loading tasks" />
        <ProgressBar label="Loading tasks" />
      </>,
    )
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(announcerLines()).toEqual(["Loading tasks"])
    expect(
      document.querySelectorAll('[data-adaptv="spinner-announcer"]'),
    ).toHaveLength(1)
    unmount()
  })

  it("a decorative bar announces nothing", () => {
    const { unmount } = render(<ProgressBar value={0.5} />)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(announcerLines()).toEqual([])
    unmount()
  })
})

/* =============================================================================
 * SSR
 * ============================================================================= */

describe("ProgressBar on the server", () => {
  it("renders the same markup every time, with no client-only attribute", () => {
    const determinate = renderToString(
      <ProgressBar value={0.25} label="Uploading photo" />,
    )
    expect(
      renderToString(<ProgressBar value={0.25} label="Uploading photo" />),
    ).toBe(determinate)
    expect(determinate).toContain('aria-valuenow="25"')
    expect(determinate).toContain("--progress-value:0.25")
    const indeterminate = renderToString(<ProgressBar label="Loading" />)
    expect(indeterminate).toContain("data-progress-bar-indeterminate")
    expect(indeterminate).not.toContain("data-progress-bar-offscreen")
  })

  it("hydrates onto its own server markup without a mismatch", async () => {
    const host = document.createElement("div")
    host.innerHTML = renderToString(<ProgressBar label="Loading tasks" />)
    document.body.appendChild(host)
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const recoverable = vi.fn()
    try {
      const root = await act(async () =>
        hydrateRoot(host, <ProgressBar label="Loading tasks" />, {
          onRecoverableError: recoverable,
        }),
      )
      expect(error).not.toHaveBeenCalled()
      expect(recoverable).not.toHaveBeenCalled()
      expect(watched(host.firstElementChild as HTMLElement)).toBe(true)
      act(() => root.unmount())
    } finally {
      error.mockRestore()
      host.remove()
    }
  })
})
