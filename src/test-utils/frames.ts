import { act } from "@testing-library/react"
import { vi } from "vitest"

/*
 * A wait on the fake clock for the tests whose components animate with motion.
 * Their `beforeEach` fakes rAF and `performance` with the timers, so motion's
 * frame loop runs on virtual time instead of real time.
 *
 * The clock moves one 16ms frame at a time. Motion captured happy-dom's own
 * rAF, a real `setImmediate`, at import, so each step yields one real
 * `setImmediate` to let that frame run before the next.
 *
 * The whole wait is a single `act`: a state update made during it commits when
 * the wait ends, not on the frame that made it.
 */
export function waitFrames(ms: number) {
  return act(async () => {
    for (let t = 0; t < ms; t += 16) {
      await vi.advanceTimersByTimeAsync(Math.min(16, ms - t))
      await new Promise((resolve) => setImmediate(resolve))
    }
  })
}
