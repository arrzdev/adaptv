import { render } from "@testing-library/react"
import { Activity, useRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  AnimatedStyleTargets,
  AnimatedStyleTransitions,
} from "#adaptv/hooks/use-animated-style"
import { useAnimatedStyle } from "#adaptv/hooks/use-animated-style"
import { waitFrames } from "#adaptv/test-utils/frames"

/*
 * `useAnimatedStyle` stands in for `<motion.div initial={false} animate
 * transition onAnimationComplete>` in the components that wrap app content, and
 * those components lean on that component's rules: PullToRefresh only leaves
 * `closing` through the completion callback, so a completion that never comes
 * (or comes for an interrupted close) parks or skips the phase.
 */

const TWEEN: AnimatedStyleTransitions = {
  y: { duration: 0.12, ease: [0.23, 1, 0.32, 1] },
}

function Harness(props: {
  targets: AnimatedStyleTargets | null
  transitions?: AnimatedStyleTransitions
  onComplete?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useAnimatedStyle(
    ref,
    props.targets,
    props.transitions ?? TWEEN,
    props.onComplete,
  )
  return <div ref={ref} data-testid="layer" />
}

//motion's frame loop reads rAF and `performance.now()`, so both run on the fake
//clock with the timers: a wait is virtual, frame by frame, instead of real
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

function layer(container: HTMLElement) {
  return container.querySelector("[data-testid=layer]") as HTMLElement
}

function translateY(el: HTMLElement) {
  const match = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform)
  return match
    ? Number(match[1])
    : el.style.transform === "none"
      ? 0
      : null
}

describe("useAnimatedStyle", () => {
  it("jumps to its first targets before paint, like `initial={false}`", () => {
    const { container } = render(
      <Harness targets={{ y: 40, top: 8, scale: 0.5, rotate: 90 }} />,
    )
    const el = layer(container)
    expect(el.style.transform).toBe(
      "translateY(40px) scale(0.5) rotate(90deg)",
    )
    expect(el.style.top).toBe("8px")
  })

  it("tweens a changed target through the values in between, then completes once", async () => {
    const onComplete = vi.fn()
    const { container, rerender } = render(
      <Harness targets={{ y: 100 }} onComplete={onComplete} />,
    )
    const el = layer(container)
    const seen: number[] = []
    const observer = new MutationObserver(() => {
      const y = translateY(el)
      if (y !== null) seen.push(y)
    })
    observer.observe(el, { attributes: true })
    rerender(<Harness targets={{ y: 0 }} onComplete={onComplete} />)
    await waitFrames(400)
    observer.disconnect()

    expect(el.style.transform).toBe("none")
    expect(seen.some((y) => y > 0 && y < 100)).toBe(true)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("does not restart for a new transition when the target is unchanged", async () => {
    const onComplete = vi.fn()
    const { container, rerender } = render(
      <Harness targets={{ y: 100 }} onComplete={onComplete} />,
    )
    rerender(<Harness targets={{ y: 0 }} onComplete={onComplete} />)
    //PullToRefresh re-renders with a new transition object every frame
    rerender(
      <Harness
        targets={{ y: 0 }}
        transitions={{ y: { duration: 2 } }}
        onComplete={onComplete}
      />,
    )
    await waitFrames(300)
    //landed on the 120ms tween it started with; a 2s restart would be midway
    expect(layer(container).style.transform).toBe("none")
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("never completes a batch a newer target interrupted, and starts the next from where it was", async () => {
    const onComplete = vi.fn()
    const { container, rerender } = render(
      <Harness targets={{ y: 100 }} onComplete={onComplete} />,
    )
    const el = layer(container)
    rerender(<Harness targets={{ y: 0 }} onComplete={onComplete} />)
    await waitFrames(40)
    const midway = translateY(el) ?? -1
    //the premise: the first tween is under way, not at either end
    expect(midway).toBeGreaterThan(0)
    expect(midway).toBeLessThan(100)

    rerender(
      <Harness
        targets={{ y: 200 }}
        transitions={{ y: { duration: 0.2, ease: "linear" } }}
        onComplete={onComplete}
      />,
    )
    await waitFrames(20)
    //no jump back to 100: the new tween leaves from the interrupted value
    expect(translateY(el)).toBeGreaterThanOrEqual(midway - 1)
    expect(translateY(el)).toBeLessThan(200)
    await waitFrames(400)
    expect(translateY(el)).toBe(200)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("fades opacity on a spring without the velocity flinging it back up", async () => {
    //PullToRefresh's release close: one spring, carrying the finger's px/s, for
    //the content's lift AND the spinner's fade
    const release = {
      type: "spring" as const,
      stiffness: 170,
      damping: 42,
      mass: 1,
      bounce: 0,
      restDelta: 0.5,
      velocity: 600,
    }
    const { container, rerender } = render(
      <Harness targets={{ opacity: 0.45 }} />,
    )
    const el = layer(container)
    const seen: number[] = []
    const observer = new MutationObserver(() => {
      seen.push(Number(el.style.opacity))
    })
    observer.observe(el, { attributes: true })
    rerender(
      <Harness
        targets={{ opacity: 0 }}
        transitions={{ opacity: release }}
      />,
    )
    await waitFrames(250)
    observer.disconnect()
    //the premise: it is fading
    expect(seen.length).toBeGreaterThan(2)
    expect(seen[seen.length - 1]).toBeLessThan(0.45)
    expect(Math.max(...seen)).toBeLessThanOrEqual(0.45)
  })

  it("lands a zero duration on the next frame, and still completes", async () => {
    const onComplete = vi.fn()
    const { container, rerender } = render(
      <Harness targets={{ width: 10 }} onComplete={onComplete} />,
    )
    rerender(
      <Harness
        targets={{ width: 50 }}
        transitions={{ width: { duration: 0 } }}
        onComplete={onComplete}
      />,
    )
    const el = layer(container)
    expect(el.style.width).toBe("10px")
    await waitFrames(50)
    expect(el.style.width).toBe("50px")
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("finishes, and completes, an animation an `<Activity>` hid midway once it is shown again", async () => {
    //hiding disconnects the effects of a component that stays mounted; the
    //element and the hook's state survive, so a stopped animation must not
    //count as landed
    const onComplete = vi.fn()
    const at = (mode: "visible" | "hidden", y: number) => (
      <Activity mode={mode}>
        <Harness targets={{ y }} onComplete={onComplete} />
      </Activity>
    )
    const { container, rerender } = render(at("visible", 100))
    const el = layer(container)
    rerender(at("visible", 0))
    await waitFrames(40)
    const midway = translateY(el) ?? -1
    //the premise: hidden while the tween is under way
    expect(midway).toBeGreaterThan(0)
    expect(midway).toBeLessThan(100)
    rerender(at("hidden", 0))
    await waitFrames(60)
    expect(onComplete).not.toHaveBeenCalled()
    rerender(at("visible", 0))
    await waitFrames(400)
    expect(el.style.transform).toBe("none")
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("keeps the other transforms when one transform key goes away", () => {
    const { container, rerender } = render(
      <Harness targets={{ y: 30, scale: 0.5 }} />,
    )
    const el = layer(container)
    expect(el.style.transform).toBe("translateY(30px) scale(0.5)")
    rerender(<Harness targets={{ y: 30 }} />)
    expect(el.style.transform).toBe("translateY(30px)")
  })

  it("completes a batch whose last animation in flight went away", async () => {
    const onComplete = vi.fn()
    const slowWidth: AnimatedStyleTransitions = {
      y: { duration: 0.05 },
      width: { duration: 2 },
    }
    const { rerender } = render(
      <Harness
        targets={{ y: 100, width: 10 }}
        transitions={slowWidth}
        onComplete={onComplete}
      />,
    )
    rerender(
      <Harness
        targets={{ y: 0, width: 50 }}
        transitions={slowWidth}
        onComplete={onComplete}
      />,
    )
    await waitFrames(200)
    //the premise: y has landed, width is still on its way
    expect(onComplete).not.toHaveBeenCalled()
    rerender(
      <Harness
        targets={{ y: 0 }}
        transitions={slowWidth}
        onComplete={onComplete}
      />,
    )
    expect(onComplete).toHaveBeenCalledTimes(1)
    await waitFrames(50)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("reads an opacity spring's `duration` in seconds, like every other transition", async () => {
    const { container, rerender } = render(
      <Harness targets={{ opacity: 1 }} />,
    )
    const el = layer(container)
    rerender(
      <Harness
        targets={{ opacity: 0 }}
        transitions={{
          opacity: { type: "spring", duration: 0.4, bounce: 0 },
        }}
      />,
    )
    await waitFrames(100)
    //a 0.4 s spring is still fading here; read as 0.4 ms it has long landed
    expect(Number(el.style.opacity)).toBeGreaterThan(0.05)
    expect(Number(el.style.opacity)).toBeLessThan(1)
    await waitFrames(700)
    expect(Number(el.style.opacity)).toBeLessThan(0.01)
  })

  it("removes what it wrote when its targets go away", async () => {
    const onComplete = vi.fn()
    const { container, rerender } = render(
      <Harness targets={{ y: 30, width: 20 }} onComplete={onComplete} />,
    )
    const el = layer(container)
    rerender(
      <Harness targets={{ y: 0, width: 20 }} onComplete={onComplete} />,
    )
    rerender(<Harness targets={{ y: 0 }} onComplete={onComplete} />)
    expect(el.style.width).toBe("")
    rerender(<Harness targets={null} onComplete={onComplete} />)
    expect(el.style.transform).toBe("")
    await waitFrames(300)
    //stopped, not finished: nothing completes and nothing is written back
    expect(el.style.transform).toBe("")
    expect(onComplete).not.toHaveBeenCalled()
  })
})
