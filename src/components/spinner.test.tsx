import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, render } from "@testing-library/react"
import type { ReactElement } from "react"
import { StrictMode } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Spinner } from "#adaptv/components/spinner"
import { compileAdaptvStyles } from "#adaptv/styles/compile.test-helper"

/*
 * The quirks `Spinner` owns, each asserted where it lives. The motion, the off-screen
 * pause and the reduced-motion form are CSS — happy-dom evaluates no media query,
 * runs no animation and compiles no Tailwind — so those are asserted on the COMPILED
 * stylesheet a consumer gets (skeleton/scroll-fade do the same). What the engines
 * actually do with them (play states, composited or not, idle cost) is
 * playground/e2e/spinner.spec.ts on chromium and webkit.
 */

/* =============================================================================
 * A controllable IntersectionObserver. Installed once for the whole file: the
 * component keeps ONE observer for the page, created on first use.
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

/** Deliver one intersection change for `el` to whichever observer watches it. */
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

function hasClass(el: Element, token: string): boolean {
  return (el.getAttribute("class") ?? "").split(/\s+/).includes(token)
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

/** The body of `@keyframes <name>` in compiled CSS, braces balanced. */
function keyframesBody(css: string, name: string): string | null {
  const start = css.indexOf(`@keyframes ${name}`)
  if (start === -1) return null
  let depth = 0
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++
    else if (css[i] === "}" && --depth === 0)
      return css.slice(start, i + 1)
  }
  return null
}

const announcerLines = () =>
  [
    ...document.querySelectorAll('[data-adaptv="spinner-announcer"] > *'),
  ].map((line) => line.textContent)

/* =============================================================================
 * RENDER & LABEL
 * ============================================================================= */

describe("Spinner renders", () => {
  it("an HTML span carrying the scope attribute, with a static svg inside", () => {
    const el = firstEl(<Spinner />)
    expect(el.tagName).toBe("SPAN")
    expect(el).toBeInstanceOf(HTMLElement)
    expect(el.getAttribute("data-adaptv")).toBe("spinner")
    const svg = el.querySelector("svg")
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute("stroke")).toBe("currentColor")
  })

  it("sits in a line of text: 1em on both axes, and a box a transform applies to", () => {
    const el = firstEl(<Spinner />)
    expect(hasClass(el, "w-[1em]")).toBe(true)
    expect(hasClass(el, "h-[1em]")).toBe(true)
    //`inline` would silently stop the rotation — a transform skips inline boxes
    expect(hasClass(el, "inline-block")).toBe(true)
  })

  it("forwards native span props and the ref", () => {
    let node: HTMLSpanElement | null = null
    const el = firstEl(
      <Spinner
        id="s"
        data-testid="t"
        ref={(n) => {
          node = n
        }}
      />,
    )
    expect(el.id).toBe("s")
    expect(el.getAttribute("data-testid")).toBe("t")
    expect(node).toBe(el)
  })
})

describe("Spinner without a label is decorative", () => {
  it("is aria-hidden with no role and no name", () => {
    const el = firstEl(<Spinner />)
    expect(el.getAttribute("aria-hidden")).toBe("true")
    expect(el.hasAttribute("role")).toBe(false)
    expect(el.hasAttribute("aria-label")).toBe(false)
  })

  it("treats a blank label as no label — a progressbar with no name says nothing", () => {
    const el = firstEl(<Spinner label="   " />)
    expect(el.getAttribute("aria-hidden")).toBe("true")
    expect(el.hasAttribute("role")).toBe(false)
  })
})

describe("Spinner with a label", () => {
  it("is an indeterminate progressbar named by the label", () => {
    const el = firstEl(<Spinner label="Loading tasks" />)
    expect(el.getAttribute("role")).toBe("progressbar")
    expect(el.getAttribute("aria-label")).toBe("Loading tasks")
    expect(el.hasAttribute("aria-hidden")).toBe(false)
    //indeterminate, per ARIA: a progressbar with no value
    expect(el.hasAttribute("aria-valuenow")).toBe(false)
  })

  it("keeps the drawing out of the tree either way", () => {
    const el = firstEl(<Spinner label="Loading tasks" />)
    expect(el.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    )
  })
})

/* =============================================================================
 * Q2 — THE ANIMATED PROPERTY IS `transform`, ON THE HTML WRAPPER
 * ============================================================================= */

describe("the motion is a transform keyframe on the HTML box", () => {
  //comments stripped: the prose names what the file avoids
  const source = readFileSync(
    join(process.cwd(), "src/styles/spinner.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "")

  it("is wired into the shipped bundle, the rule inside the components layer", async () => {
    const css = await compileAdaptvStyles([])
    const layer = css.indexOf("@layer adaptv.components")
    expect(layer).toBeGreaterThan(-1)
    expect(css.indexOf('[data-adaptv="spinner"]')).toBeGreaterThan(layer)
    expect(css).toMatch(
      /\[data-adaptv="spinner"\]\s*\{\s*animation: adaptv-spinner-spin [^;]*linear infinite;?\s*\}/,
    )
  })

  it("rotates with `transform`, never the individual `rotate` property", async () => {
    const css = await compileAdaptvStyles([])
    const spin = keyframesBody(css, "adaptv-spinner-spin")
    expect(spin).not.toBeNull()
    expect(spin).toMatch(/transform: rotate\(360deg\)/)
    //`rotate:` as its own property falls back to the main thread on an svg (traced
    //524288), and is one more thing to keep in step for HTML — spell `transform`
    expect(spin).not.toMatch(/(^|[;{\s])rotate\s*:/)
  })

  it("turns the identity element itself; its svg child only ever pulses or pauses", async () => {
    const css = await compileAdaptvStyles([])
    //every rule that names the spinner scope: its selectors and its declarations
    const rules = [
      ...css.matchAll(
        /([^{}]*\[data-adaptv="spinner"\][^{}]*)\{([^{}]*)\}/g,
      ),
    ].map((m) => ({
      selectors: m[1].split(",").map((part) => part.trim()),
      body: m[2].trim(),
    }))
    expect(rules.length).toBeGreaterThan(0)
    for (const { selectors, body } of rules) {
      for (const selector of selectors) {
        //the box, the box with one attribute, or its DIRECT svg child — never a
        //descendant, never anything drawn inside the svg
        expect(selector).toMatch(
          /^\[data-adaptv="spinner"\](\[[a-z-]+\])?( > svg)?$/,
        )
        if (selector.endsWith("> svg"))
          expect(body).toMatch(
            /^(animation: adaptv-spinner-pulse [^;]*;?|animation-play-state: paused;?)$/,
          )
      }
    }
    //the turn itself names no svg
    const spin = rules.filter((rule) =>
      rule.body.includes("adaptv-spinner-spin"),
    )
    expect(spin).toHaveLength(1)
    expect(spin[0].selectors).toEqual(['[data-adaptv="spinner"]'])
  })

  it("draws a static arc: no SMIL, no dash, no transform on the drawing", () => {
    const svg = firstEl(<Spinner />).querySelector("svg")
    expect(svg).not.toBeNull()
    expect(
      svg?.querySelectorAll(
        "animate, animateTransform, animateMotion, set",
      ).length,
    ).toBe(0)
    for (const node of [svg, ...(svg?.querySelectorAll("*") ?? [])]) {
      expect(node?.hasAttribute("stroke-dasharray")).toBe(false)
      expect(node?.hasAttribute("transform")).toBe(false)
      expect(node?.getAttribute("class") ?? "").not.toMatch(/animate-/)
    }
  })

  it("uses no !important — the layer is the mechanism (styling.md §6.0.1)", () => {
    expect(source).not.toContain("!important")
  })
})

/* =============================================================================
 * Q1 — PAUSED WHILE OFF SCREEN
 * ============================================================================= */

describe("Spinner pauses off screen", () => {
  it("is watched by ONE observer shared by every spinner", () => {
    const { container } = render(
      <>
        <Spinner />
        <Spinner />
        <Spinner />
      </>,
    )
    const spinners = [...container.querySelectorAll("[data-adaptv]")]
    expect(spinners).toHaveLength(3)
    for (const el of spinners) expect(watched(el)).toBe(true)
    expect(FakeIntersectionObserver.instances).toHaveLength(1)
  })

  it("stamps data-spinner-offscreen when it leaves the viewport, and clears it on return", () => {
    const el = firstEl(<Spinner />)
    expect(el.hasAttribute("data-spinner-offscreen")).toBe(false)

    act(() => intersect(el, false))
    expect(el.hasAttribute("data-spinner-offscreen")).toBe(true)

    act(() => intersect(el, true))
    expect(el.hasAttribute("data-spinner-offscreen")).toBe(false)
  })

  it("stops being watched when it unmounts", () => {
    const { container, unmount } = render(<Spinner />)
    const el = container.firstElementChild as HTMLElement
    expect(watched(el)).toBe(true)
    unmount()
    expect(watched(el)).toBe(false)
  })

  it("the stylesheet turns the stamp into a paused animation", async () => {
    const css = await compileAdaptvStyles([])
    //the box's turn, and the drawing's pulse under reduced motion
    expect(css).toMatch(
      /\[data-adaptv="spinner"\]\[data-spinner-offscreen\],\s*\[data-adaptv="spinner"\]\[data-spinner-offscreen\] > svg\s*\{\s*animation-play-state: paused;?\s*\}/,
    )
  })

  it("the pause outranks the reduced-motion shorthand, which resets play state", async () => {
    //`animation: …` inside the media block resets animation-play-state to running.
    //Two attribute selectors (0,2,0) beat one (0,1,0) wherever the rules sit — so the
    //pause must stay a COMPOUND selector, never a lone attribute.
    const css = await compileAdaptvStyles([])
    const pause = css.indexOf("animation-play-state: paused")
    const before = css.slice(0, pause)
    const selector = before.slice(before.lastIndexOf("}") + 1).trim()
    expect(selector).toBe(
      '[data-adaptv="spinner"][data-spinner-offscreen], [data-adaptv="spinner"][data-spinner-offscreen] > svg {',
    )
  })
})

/* =============================================================================
 * REDUCED MOTION — a pulse, never a stop
 * ============================================================================= */

describe("reduced motion", () => {
  it("swaps the rotation for an opacity pulse in CSS, not for a stop", async () => {
    const css = await compileAdaptvStyles([])
    const blocks = mediaBlocks(css, "(prefers-reduced-motion: reduce)")
    const ours = blocks.filter((block) =>
      block.includes('[data-adaptv="spinner"]'),
    )
    expect(ours).toHaveLength(1)
    //the box stops turning…
    expect(ours[0]).toMatch(
      /\[data-adaptv="spinner"\]\s*\{\s*animation: none;?\s*\}/,
    )
    //…and its drawing pulses: an indeterminate indicator that stops says "done"
    expect(ours[0]).toMatch(
      /\[data-adaptv="spinner"\] > svg\s*\{\s*animation: adaptv-spinner-pulse [^;]*infinite;?\s*\}/,
    )
  })

  it("pulses the svg child, so a consumer's opacity on the box still applies", async () => {
    //an animation outranks every normal declaration: keyed on the box, the pulse
    //would override `opacity-50` in className for as long as it ran
    const css = await compileAdaptvStyles([])
    const pulses = [
      ...css.matchAll(/([^{}]*)\{\s*animation: adaptv-spinner-pulse/g),
    ].map((m) => m[1].trim())
    expect(pulses).toEqual(['[data-adaptv="spinner"] > svg'])
  })

  it("pulses opacity only — nothing moves across the screen", async () => {
    const css = await compileAdaptvStyles([])
    const pulse = keyframesBody(css, "adaptv-spinner-pulse")
    expect(pulse).not.toBeNull()
    expect(pulse).toMatch(/opacity:/)
    expect(pulse).not.toMatch(/transform|rotate|scale|translate/)
  })

  it("is answered by the stylesheet, so the first paint is already right", () => {
    //useReducedMotion is `false` on the server and during hydration
    expect(
      readFileSync(
        join(process.cwd(), "src/components/spinner.tsx"),
        "utf8",
      ),
    ).not.toMatch(/from "#adaptv\/hooks\/use-reduced-motion"/)
  })
})

/* =============================================================================
 * ANNOUNCEMENT — once per episode, not per instance, not per render
 * ============================================================================= */

describe("a labelled spinner is announced once", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    //every test unmounts its own spinners, ending its episodes; drain what is left
    act(() => {
      vi.runAllTimers()
    })
    vi.useRealTimers()
  })

  it("three spinners with one label mounting together are one announcement", () => {
    const { unmount } = render(
      <>
        <Spinner label="Loading tasks" />
        <Spinner label="Loading tasks" />
        <Spinner label="Loading tasks" />
      </>,
    )
    const region = document.querySelector(
      '[data-adaptv="spinner-announcer"]',
    )
    //the region exists BEFORE its text changes — a region mounted with its text is
    //not reliably read
    expect(region).not.toBeNull()
    expect(announcerLines()).toEqual([])

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(region?.getAttribute("role")).toBe("status")
    expect(region?.getAttribute("aria-live")).toBe("polite")
    expect(hasClass(region as Element, "sr-only")).toBe(true)
    expect(announcerLines()).toEqual(["Loading tasks"])
    unmount()
  })

  it("a re-render does not announce again", () => {
    const { rerender, unmount } = render(<Spinner label="Loading" />)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    rerender(<Spinner label="Loading" className="size-8" />)
    rerender(<Spinner label="Loading" className="size-6" />)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(announcerLines()).toEqual(["Loading"])
    unmount()
  })

  it("a StrictMode mount (effects run twice) is one announcement", () => {
    const { unmount } = render(
      <StrictMode>
        <Spinner label="Loading strict" />
      </StrictMode>,
    )
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(announcerLines()).toEqual(["Loading strict"])
    unmount()
  })

  it("a decorative spinner announces nothing", () => {
    const { unmount } = render(<Spinner />)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(announcerLines()).toEqual([])
    unmount()
  })

  it("a load that ends inside the delay is never announced", () => {
    const { unmount } = render(<Spinner label="Quick" />)
    act(() => {
      vi.advanceTimersByTime(50)
    })
    unmount()
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(announcerLines()).toEqual([])
  })

  it("a new episode, after every spinner with that label unmounted, is announced again", () => {
    const first = render(<Spinner label="Loading photos" />)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    first.unmount()
    const second = render(<Spinner label="Loading photos" />)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(announcerLines()).toEqual(["Loading photos", "Loading photos"])
    second.unmount()
  })

  it("each label waits its own delay: a second label that starts later is not flushed by the first", () => {
    const a = render(<Spinner label="Syncing A" />)
    act(() => {
      vi.advanceTimersByTime(140)
    })
    const b = render(<Spinner label="Syncing B" />)
    act(() => {
      vi.advanceTimersByTime(12)
    })
    //t=152: A is past its delay, B is 12 ms old
    expect(announcerLines()).toEqual(["Syncing A"])
    act(() => {
      vi.advanceTimersByTime(8)
    })
    //t=160: B ended inside ITS delay — a flash, never said
    b.unmount()
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(announcerLines()).toEqual(["Syncing A"])
    a.unmount()
  })

  it("a remount inside the delay of an ended episode waits its own delay", () => {
    const first = render(<Spinner label="Syncing C" />)
    act(() => {
      vi.advanceTimersByTime(100)
    })
    first.unmount()
    act(() => {
      vi.advanceTimersByTime(40)
    })
    const second = render(<Spinner label="Syncing C" />)
    act(() => {
      vi.advanceTimersByTime(20)
    })
    //t=160: the first episode's timer has fired, but the second is 20 ms old
    expect(announcerLines()).toEqual([])
    act(() => {
      vi.advanceTimersByTime(130)
    })
    //t=290: the second episode is 150 ms old
    expect(announcerLines()).toEqual(["Syncing C"])
    second.unmount()
  })

  it("an announced line leaves the region once the reader has had it", () => {
    const { unmount } = render(<Spinner label="Loading" />)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(announcerLines()).toEqual(["Loading"])
    act(() => {
      vi.advanceTimersByTime(7000)
    })
    expect(announcerLines()).toEqual([])
    unmount()
  })
})

/* =============================================================================
 * SSR
 * ============================================================================= */

describe("Spinner on the server", () => {
  it("renders the same markup every time, with no client-only attribute", () => {
    const labelled = renderToString(<Spinner label="Loading tasks" />)
    expect(renderToString(<Spinner label="Loading tasks" />)).toBe(
      labelled,
    )
    expect(labelled).toContain('data-adaptv="spinner"')
    expect(labelled).toContain('role="progressbar"')
    expect(labelled).toContain('aria-label="Loading tasks"')
    expect(labelled).not.toContain("data-spinner-offscreen")

    const decorative = renderToString(<Spinner />)
    expect(decorative).toContain('aria-hidden="true"')
    expect(decorative).not.toContain("role=")
  })

  it("hydrates onto its own server markup without a mismatch", async () => {
    const host = document.createElement("div")
    host.innerHTML = renderToString(<Spinner label="Loading tasks" />)
    document.body.appendChild(host)
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const recoverable = vi.fn()
    try {
      const root = await act(async () =>
        hydrateRoot(host, <Spinner label="Loading tasks" />, {
          onRecoverableError: recoverable,
        }),
      )
      expect(error).not.toHaveBeenCalled()
      expect(recoverable).not.toHaveBeenCalled()
      //and the client took over the server's node rather than replacing it
      const el = host.firstElementChild as HTMLElement
      expect(watched(el)).toBe(true)
      act(() => root.unmount())
    } finally {
      error.mockRestore()
      host.remove()
    }
  })
})
