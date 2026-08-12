import { describe, expect, it } from "vitest"
import {
  DEFAULT_DRAWER_TRANSITION,
  DRAWER_TRANSITIONS,
} from "#adaptv/components/drawer/drawer-constants"
import type { EasingBezier } from "#adaptv/components/drawer/drawer-easing"
import type { PanelFlight } from "#adaptv/components/drawer/drawer-motion"
import {
  resumeDrawerTransition,
  tweenDrawerPanelTransform,
} from "#adaptv/components/drawer/drawer-motion"

const OPEN: EasingBezier = [...DRAWER_TRANSITIONS.EASE]

function flight(elapsed: number): PanelFlight {
  return {
    elapsed,
    left: DEFAULT_DRAWER_TRANSITION.duration * (1 - elapsed),
    bezier: OPEN,
  }
}

/** px/s the resumed transition starts at, from its own entry slope over travel/duration. */
function entrySpeed(
  transition: { bezier: EasingBezier; duration: number },
  travel: number,
) {
  const [x1, y1] = transition.bezier
  return ((y1 / x1) * travel) / transition.duration
}

describe("resumeDrawerTransition", () => {
  it("falls back to a fresh open when nothing was in flight", () => {
    expect(resumeDrawerTransition(null, 100, 140)).toBe(
      DEFAULT_DRAWER_TRANSITION,
    )
  })

  it("is the untouched open curve when the motion had not started", () => {
    const resumed = resumeDrawerTransition(flight(0), 422, 758)
    expect(resumed.bezier).toEqual(OPEN)
    //more travel than a fresh motion carries, but never longer than one
    expect(resumed.duration).toBe(DEFAULT_DRAWER_TRANSITION.duration)
  })

  describe("the iPhone's two-step keyboard raise", () => {
    // Measured on a physical device, cold cache: the open slide is 39% in, painting 59px from
    // its target, when iOS's password AutoFill bar adds 45px to the keyboard.
    const interrupted = flight(0.392)
    const resumed = resumeDrawerTransition(interrupted, 59, 59 + 45)

    it("keeps the sheet moving instead of restarting the curve", () => {
      //what the sheet was doing at the seam, from the interrupted curve
      const before = entrySpeed(
        { bezier: OPEN, duration: DEFAULT_DRAWER_TRANSITION.duration },
        0,
      )
      expect(before).toBe(0) //guards the helper: a fresh curve at zero travel goes nowhere
      const restart = entrySpeed(DEFAULT_DRAWER_TRANSITION, 104)
      const resumedSpeed = entrySpeed(resumed, 104)
      //a restart would enter at ~615px/s against the ~930px/s the sheet already had — the
      //visible "it hesitates, then crawls" of the first cold open. Asserted as a ratio, because
      //the absolute numbers move whenever the open curve is tuned and the hesitation is the point.
      expect(restart).toBeLessThan(700)
      expect(resumedSpeed).toBeGreaterThan(restart * 1.5)
    })

    it("spends the time the interrupted motion had left, plus the added travel", () => {
      //~231ms left on the open curve, ~45px added at ~930px/s ≈ 48ms
      expect(resumed.duration).toBeCloseTo(0.28, 2)
      expect(resumed.duration).toBeGreaterThan(interrupted.left)
      expect(resumed.duration).toBeLessThan(
        DEFAULT_DRAWER_TRANSITION.duration,
      )
    })
  })

  it("never runs longer than a fresh motion, however late the interrupt", () => {
    for (let at = 0; at < 1; at += 0.05) {
      const resumed = resumeDrawerTransition(
        flight(at),
        400 * (1 - at),
        800,
      )
      expect(resumed.duration).toBeLessThanOrEqual(
        DEFAULT_DRAWER_TRANSITION.duration,
      )
      expect(resumed.duration).toBeGreaterThan(0)
    }
  })

  it("does not stretch when the geometry change removes travel", () => {
    //a shrink mid-slide leaves LESS to cover; the remaining time is the floor, not a target
    const interrupted = flight(0.5)
    const resumed = resumeDrawerTransition(interrupted, 200, 120)
    expect(resumed.duration).toBeCloseTo(interrupted.left, 6)
  })
})

/*
 * The keyframe tween — the mechanism the panel's motion moved to.
 *
 * These need stubbing, because jsdom has neither `getAnimations` nor `DOMMatrixReadOnly`: without
 * them every branch below short-circuits and the suite passes whether the code works or not. It
 * did exactly that, and the re-entrancy bug the last test here pins went in unnoticed — a browser
 * run caught it. A stub that makes the path executable is worth more than a faithful DOM.
 */
describe("tweenDrawerPanelTransform", () => {
  class FakeAnimation {
    animationName: string
    finished: Promise<void>
    private settle!: () => void
    constructor(name: string) {
      this.animationName = name
      this.finished = new Promise<void>((resolve) => {
        this.settle = resolve
      })
    }
    finish() {
      this.settle()
    }
  }

  function panelWith(running: FakeAnimation[]) {
    const vars: Record<string, string> = {}
    const panel = {
      style: {
        transform: "",
        transition: "",
        animation: "",
        setProperty: (key: string, value: string) => {
          vars[key] = value
        },
        removeProperty: (key: string) => {
          delete vars[key]
        },
      },
      getAnimations: () => running,
    } as unknown as HTMLElement
    return { panel, vars }
  }

  //`readPanelTranslateY` reads computed style and parses a matrix; both are stubbed through to the
  //inline transform so a `commit` that writes one is visible to the code under test
  async function withDomStubs(run: () => Promise<void>) {
    const realComputed = globalThis.getComputedStyle
    const holder = globalThis as { DOMMatrixReadOnly?: unknown }
    const realMatrix = holder.DOMMatrixReadOnly
    globalThis.getComputedStyle = ((element: {
      style?: { transform?: string }
    }) => ({
      transform: element.style?.transform || "none",
    })) as unknown as typeof globalThis.getComputedStyle
    holder.DOMMatrixReadOnly = class {
      m42: number
      constructor(value: string) {
        this.m42 = Number.parseFloat(
          /,\s*(-?[\d.]+)px/.exec(value)?.[1] ?? "0",
        )
      }
    }
    try {
      await run()
    } finally {
      globalThis.getComputedStyle = realComputed
      holder.DOMMatrixReadOnly = realMatrix
    }
  }

  it("commits the target, then animates to where it landed", async () => {
    await withDomStubs(async () => {
      const armed = new FakeAnimation("pwa-drawer-slide")
      const { panel, vars } = panelWith([armed])
      panel.style.transform = "translate3d(0, 0px, 0)"

      const pending = tweenDrawerPanelTransform(
        panel,
        DEFAULT_DRAWER_TRANSITION,
        () => {
          panel.style.transform = "translate3d(0, 229px, 0)"
        },
      )

      //the endpoints are whatever `commit` produced — no caller has to know how they compose
      expect(vars["--pwa-drawer-from"]).toBe("0px")
      expect(vars["--pwa-drawer-to"]).toBe("229px")
      expect(panel.style.animation).toContain("pwa-drawer-slide")
      expect(panel.style.animation).toContain(
        `${DEFAULT_DRAWER_TRANSITION.duration}s`,
      )

      armed.finish()
      await pending
      //handed back to the inline transform, which `commit` already put at the target. A keyframe
      //left filling here would swallow every write the next drag makes.
      expect(panel.style.animation).toBe("")
    })
  })

  it("skips the animation when the commit did not move the panel", async () => {
    await withDomStubs(async () => {
      const { panel } = panelWith([])
      panel.style.transform = "translate3d(0, 12px, 0)"
      let committed = 0
      await tweenDrawerPanelTransform(
        panel,
        DEFAULT_DRAWER_TRANSITION,
        () => {
          committed += 1
        },
      )
      expect(committed).toBe(1)
      expect(panel.style.animation).toBe("")
    })
  })

  it("leaves a newer motion alone when an interrupted one finishes", async () => {
    /*
     * The panel's motion is superseded mid-flight all the time — a close re-aims on a viewport
     * shift, the keyboard re-aims when its height lands in two steps, a drag release interrupts an
     * open. The interrupted call's promise settles moments later, and clearing unconditionally
     * there strips the animation that just replaced it, dropping the panel onto the inline
     * transform: the sheet jumps the rest of the way instead of easing.
     */
    await withDomStubs(async () => {
      const first = new FakeAnimation("pwa-drawer-slide")
      const running = [first]
      const { panel } = panelWith(running)
      panel.style.transform = "translate3d(0, 0px, 0)"

      const interrupted = tweenDrawerPanelTransform(
        panel,
        DEFAULT_DRAWER_TRANSITION,
        () => {
          panel.style.transform = "translate3d(0, 229px, 0)"
        },
      )

      //a second tween takes over and arms its own animation
      const second = new FakeAnimation("pwa-drawer-slide")
      running[0] = second
      panel.style.animation = "pwa-drawer-slide 0.32s ease both"

      first.finish()
      await interrupted

      expect(panel.style.animation).toBe(
        "pwa-drawer-slide 0.32s ease both",
      )
    })
  })
})
