import { act, render } from "@testing-library/react"
import { useRef } from "react"
import { describe, expect, it, vi } from "vitest"
import type {
  AnimatedStyleTargets,
  AnimatedStyleTransitions,
} from "#adaptv/hooks/use-animated-style"
import { useAnimatedStyle } from "#adaptv/hooks/use-animated-style"

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

const wait = (ms: number) =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

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
    await wait(400)
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
    await wait(300)
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
    await wait(40)
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
    await wait(20)
    //no jump back to 100: the new tween leaves from the interrupted value
    expect(translateY(el)).toBeGreaterThanOrEqual(midway - 1)
    expect(translateY(el)).toBeLessThan(200)
    await wait(400)
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
    await wait(250)
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
    await wait(50)
    expect(el.style.width).toBe("50px")
    expect(onComplete).toHaveBeenCalledTimes(1)
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
    await wait(300)
    //stopped, not finished: nothing completes and nothing is written back
    expect(el.style.transform).toBe("")
    expect(onComplete).not.toHaveBeenCalled()
  })
})
