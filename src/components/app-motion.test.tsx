import { act, fireEvent, render } from "@testing-library/react"
// biome-ignore lint/style/noRestrictedImports: the APP's motion tree is what these tests put inside adaptv's components
import { domMax, LazyMotion, MotionContext, m, motion } from "motion/react"
import type { ReactNode } from "react"
import { forwardRef, useContext, useEffect, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Button } from "#adaptv/components/button"
import { PullToRefresh } from "#adaptv/components/pull-to-refresh"

/*
 * Button and PullToRefresh wrap the app's content, and the app is free to
 * animate that content with motion itself. Whatever adaptv does to animate its
 * own layers must not reach the app's motion tree (docs/decisions/animation.md
 * A7, §3.1).
 *
 * A motion provider does reach it. `LazyMotion` hands its subtree a new context
 * object on every render, and every motion element reads that context, so an
 * app row re-renders each time the wrapper does even though React was handed the
 * very same element. PullToRefresh renders on every pointer frame of a pull, and
 * a `layout` row re-snapshots its box on each of those renders. The provider
 * also replaces the app's own `LazyMotion` below it: its async features never
 * arrive and its `strict` stops being enforced.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reduce && query.includes("reduce"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
}

function countingRow(counts: { renders: number }) {
  return motion.create(
    forwardRef<HTMLDivElement>(function AppRow(_props, ref) {
      counts.renders++
      return <div ref={ref} />
    }),
  )
}

/** Re-renders `wrap(children)` on demand with the SAME children element. */
function rerenderingParent(wrap: (children: ReactNode) => ReactNode) {
  const handle = { bump: () => {} }
  function Parent({ children }: { children: ReactNode }) {
    const [, setTick] = useState(0)
    handle.bump = () => setTick((tick) => tick + 1)
    return <>{wrap(children)}</>
  }
  return { Parent, handle }
}

const RERENDERS = 10

describe("an app's motion row inside adaptv's animated wrappers", () => {
  it("renders once across PullToRefresh re-renders, not once per wrapper render", () => {
    stubReducedMotion(false)
    const counts = { renders: 0 }
    const AppRow = countingRow(counts)
    const { Parent, handle } = rerenderingParent((children) => (
      <PullToRefresh onRefresh={async () => {}}>{children}</PullToRefresh>
    ))
    render(
      <Parent>
        <AppRow layout />
      </Parent>,
    )
    expect(counts.renders).toBe(1)
    for (let i = 0; i < RERENDERS; i++) act(() => handle.bump())
    expect(counts.renders).toBe(1)
  })

  it("renders once across Button re-renders", () => {
    stubReducedMotion(false)
    const counts = { renders: 0 }
    const AppRow = countingRow(counts)
    const { Parent, handle } = rerenderingParent((children) => (
      <Button>{children}</Button>
    ))
    render(
      <Parent>
        <AppRow layout />
      </Parent>,
    )
    const settled = counts.renders
    for (let i = 0; i < RERENDERS; i++) act(() => handle.bump())
    expect(counts.renders).toBe(settled)
  })

  it("renders once across the frames of a real pull", () => {
    stubReducedMotion(false)
    const counts = { renders: 0 }
    const AppRow = countingRow(counts)
    const { container } = render(
      <PullToRefresh onRefresh={async () => {}}>
        <AppRow layout />
      </PullToRefresh>,
    )
    const root = container.querySelector('[data-adaptv="pull-to-refresh"]')
    if (!(root instanceof HTMLElement)) throw new Error("no gesture root")
    act(() => {
      fireEvent.pointerDown(root, pointer(0, 0))
    })
    for (let i = 1; i <= 30; i++) {
      act(() => {
        fireEvent.pointerMove(root, pointer(0, 20 + i * 2))
      })
    }
    expect(counts.renders).toBe(1)
  })
})

describe("an app's `<LazyMotion strict>` around adaptv's animated wrappers", () => {
  //motion throws for a full `motion` element under a strict provider; that is
  //the app's own guard against shipping the full feature set

  it("still throws for an app `motion.div` inside PullToRefresh", () => {
    stubReducedMotion(false)
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() =>
      render(
        <LazyMotion strict features={domMax}>
          <PullToRefresh onRefresh={async () => {}}>
            <motion.div animate={{ x: 1 }} />
          </PullToRefresh>
        </LazyMotion>,
      ),
    ).toThrow(/LazyMotion/)
  })

  it("still throws for an app `motion.span` inside Button", () => {
    stubReducedMotion(false)
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() =>
      render(
        <LazyMotion strict features={domMax}>
          <Button>
            <motion.span animate={{ x: 1 }}>Go</motion.span>
          </Button>
        </LazyMotion>,
      ),
    ).toThrow(/LazyMotion/)
  })

  it("accepts both wrappers themselves, with app `m` content inside", () => {
    stubReducedMotion(false)
    expect(() =>
      render(
        <LazyMotion strict features={domMax}>
          <PullToRefresh onRefresh={async () => {}}>
            <m.div animate={{ x: 1 }} />
          </PullToRefresh>
          <Button>
            <m.span animate={{ x: 1 }}>Go</m.span>
          </Button>
        </LazyMotion>,
      ),
    ).not.toThrow()
  })
})

describe("an app's async `LazyMotion` features inside adaptv's animated wrappers", () => {
  it("reach app `m` elements inside Button and PullToRefresh when they load, and not before", async () => {
    stubReducedMotion(false)
    type Seen = { visualElement?: { features: Record<string, unknown> } }
    const seen: Record<string, Seen> = {}
    function Probe({ name }: { name: string }) {
      seen[name] = useContext(MotionContext) as Seen
      return null
    }
    let resolve: (features: typeof domMax) => void = () => {}
    const loading = new Promise<typeof domMax>((r) => {
      resolve = r
    })
    const app = (
      <LazyMotion features={() => loading}>
        <m.div whileHover={{ scale: 1.1 }}>
          <Probe name="outside" />
        </m.div>
        <PullToRefresh onRefresh={async () => {}}>
          <m.div whileHover={{ scale: 1.1 }}>
            <Probe name="pullToRefresh" />
          </m.div>
        </PullToRefresh>
        <Button>
          <m.span whileHover={{ scale: 1.1 }}>
            <Probe name="button" />
            Go
          </m.span>
        </Button>
      </LazyMotion>
    )
    render(app)
    const features = (name: string) => {
      const element = seen[name]?.visualElement
      return element
        ? Object.keys(element.features).sort()
        : "not animated"
    }
    //before the app's features arrive, its `m` elements do not animate at all:
    //that is the point of loading them lazily, inside a wrapper as outside it
    expect(features("outside")).toBe("not animated")
    expect(features("pullToRefresh")).toBe("not animated")
    expect(features("button")).toBe("not animated")

    await act(async () => {
      resolve(domMax)
      await loading
      await new Promise((r) => setTimeout(r, 20))
    })
    //once they do, every element has them without an app re-render to help
    //(the first line is the premise: they loaded, and they include hover)
    expect(features("outside")).toContain("hover")
    expect(features("pullToRefresh")).toEqual(features("outside"))
    expect(features("button")).toEqual(features("outside"))
  })
})

function pointer(x: number, y: number) {
  //`isPrimary` must be explicit: synthetic PointerEvents default it to FALSE
  return { clientX: x, clientY: y, pointerId: 1, isPrimary: true }
}

describe("PullToRefresh's content layer", () => {
  it("keeps the app's content mounted when a pull lifts it", () => {
    stubReducedMotion(false)
    const mounts = { count: 0 }
    function AppContent() {
      useEffect(() => {
        mounts.count++
      }, [])
      return <p>content</p>
    }
    const { container } = render(
      <PullToRefresh onRefresh={async () => {}}>
        <AppContent />
      </PullToRefresh>,
    )
    const root = container.querySelector('[data-adaptv="pull-to-refresh"]')
    if (!(root instanceof HTMLElement)) throw new Error("no gesture root")
    expect(mounts.count).toBe(1)
    act(() => {
      fireEvent.pointerDown(root, pointer(0, 0))
    })
    for (let i = 1; i <= 10; i++) {
      act(() => {
        fireEvent.pointerMove(root, pointer(0, 20 + i * 4))
      })
    }
    //the premise: the pull did lift the content
    const content = container.querySelector("p")?.parentElement
    expect(content?.style.transform).toMatch(/translateY\(/)
    expect(mounts.count).toBe(1)
  })
})
