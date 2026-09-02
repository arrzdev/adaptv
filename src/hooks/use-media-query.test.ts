import { act, render } from "@testing-library/react"
import { createElement, useRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useMediaQuery } from "#adaptv/hooks/use-media-query"
import { useReducedMotion } from "#adaptv/hooks/use-reduced-motion"

/*
 * One live MediaQueryList per query, shared by every consumer.
 *
 * `matchMedia` hands out a fresh list object on every call, so a hook that calls
 * it per subscriber and again per snapshot read scales with the number of
 * components on screen — measured at 16 lists and 16 `change` listeners for the
 * reduced-motion query alone on the image lab page. The registry under test
 * makes that 1 and 1, and lets a component that mounts with the preference
 * already on render once with the right value instead of twice.
 */

type FakeList = {
  matches: boolean
  listeners: Set<(event: { matches: boolean }) => void>
}

function stubMatchMedia(initial: Record<string, boolean> = {}) {
  const lists = new Map<string, FakeList[]>()
  //the state of each query, shared by every list handed out for it — like the
  //browser, where a fresh list reflects the query as it stands NOW
  const state = new Map<string, boolean>(Object.entries(initial))
  const matchMedia = vi.fn((query: string) => {
    const list: FakeList = {
      matches: state.get(query) ?? false,
      listeners: new Set(),
    }
    lists.set(query, [...(lists.get(query) ?? []), list])
    return {
      get matches() {
        return list.matches
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (
        _type: string,
        listener: (event: { matches: boolean }) => void,
      ) => {
        list.listeners.add(listener)
      },
      removeEventListener: (
        _type: string,
        listener: (event: { matches: boolean }) => void,
      ) => {
        list.listeners.delete(listener)
      },
      dispatchEvent: () => false,
    } as unknown as MediaQueryList
  })
  vi.stubGlobal("matchMedia", matchMedia)
  return {
    matchMedia,
    /** Every list ever created for `query`, in creation order. */
    listsFor: (query: string) => lists.get(query) ?? [],
    /** Flip the query and notify every listener on every list, like the browser. */
    set(query: string, matches: boolean) {
      state.set(query, matches)
      for (const list of lists.get(query) ?? []) {
        list.matches = matches
        for (const listener of list.listeners) listener({ matches })
      }
    },
  }
}

const REDUCED = "(prefers-reduced-motion: reduce)"

/** Renders the hook's value and counts its own renders. */
function probe(useValue: () => boolean, renders: { count: number }) {
  return function Probe() {
    renders.count++
    const value = useValue()
    const first = useRef(value)
    return createElement("i", {
      "data-value": String(value),
      "data-first": String(first.current),
    })
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useMediaQuery", () => {
  it("creates one MediaQueryList per query, however many consumers", () => {
    const media = stubMatchMedia()
    const Probe = probe(() => useMediaQuery(REDUCED), { count: 0 })
    render(
      createElement(
        "div",
        null,
        ...Array.from({ length: 20 }, (_, i) =>
          createElement(Probe, { key: i }),
        ),
      ),
    )
    expect(media.matchMedia).toHaveBeenCalledTimes(1)
    expect(media.listsFor(REDUCED)).toHaveLength(1)
    expect(media.listsFor(REDUCED)[0]?.listeners.size).toBe(1)
  })

  it("tracks the query for every consumer from the one list", () => {
    const media = stubMatchMedia()
    const Probe = probe(() => useMediaQuery(REDUCED), { count: 0 })
    const { container } = render(
      createElement(
        "div",
        null,
        createElement(Probe),
        createElement(Probe),
        createElement(Probe),
      ),
    )
    const values = () =>
      [...container.querySelectorAll("i")].map((el) =>
        el.getAttribute("data-value"),
      )
    expect(values()).toEqual(["false", "false", "false"])
    act(() => media.set(REDUCED, true))
    expect(values()).toEqual(["true", "true", "true"])
    act(() => media.set(REDUCED, false))
    expect(values()).toEqual(["false", "false", "false"])
  })

  it("does not grow the registry when consumers come and go", () => {
    const media = stubMatchMedia()
    const Probe = probe(() => useMediaQuery(REDUCED), { count: 0 })
    const first = render(createElement(Probe))
    first.unmount()
    render(createElement(Probe))
    expect(media.matchMedia).toHaveBeenCalledTimes(1)
  })

  it("is `false` for a null query and never asks the browser", () => {
    const media = stubMatchMedia({ [REDUCED]: true })
    const Probe = probe(() => useMediaQuery(null), { count: 0 })
    const { container } = render(createElement(Probe))
    expect(container.querySelector("i")?.getAttribute("data-value")).toBe(
      "false",
    )
    expect(media.matchMedia).not.toHaveBeenCalled()
  })

  it("starts over when `matchMedia` itself is replaced", () => {
    stubMatchMedia({ [REDUCED]: false })
    const Probe = probe(() => useMediaQuery(REDUCED), { count: 0 })
    const a = render(createElement(Probe))
    expect(
      a.container.querySelector("i")?.getAttribute("data-value"),
    ).toBe("false")
    a.unmount()
    //a second stub — the shape every test file that stubs per case relies on
    stubMatchMedia({ [REDUCED]: true })
    const b = render(createElement(Probe))
    expect(
      b.container.querySelector("i")?.getAttribute("data-value"),
    ).toBe("true")
  })
})

describe("useReducedMotion", () => {
  it("renders once, with the preference already applied", () => {
    stubMatchMedia({ [REDUCED]: true })
    const renders = { count: 0 }
    const Probe = probe(useReducedMotion, renders)
    const { container } = render(createElement(Probe))
    const el = container.querySelector("i")
    expect(el?.getAttribute("data-value")).toBe("true")
    //the value the FIRST render saw — an effect-then-setState hook renders
    //`false` first and corrects itself a commit later
    expect(el?.getAttribute("data-first")).toBe("true")
    expect(renders.count).toBe(1)
  })

  it("shares the reduced-motion list with every other consumer", () => {
    const media = stubMatchMedia()
    const Probe = probe(useReducedMotion, { count: 0 })
    render(
      createElement(
        "div",
        null,
        ...Array.from({ length: 16 }, (_, i) =>
          createElement(Probe, { key: i }),
        ),
      ),
    )
    expect(media.matchMedia).toHaveBeenCalledTimes(1)
    expect(media.listsFor(REDUCED)[0]?.listeners.size).toBe(1)
  })
})
