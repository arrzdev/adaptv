import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  SPLASH_REVEALED_ATTR,
  useSplashHandoff,
} from "#adaptv/hooks/use-splash-handoff"

//The handoff is a sequence, and every assertion here is about ORDER: the OS splash
//must not lift before the app's splash has painted, and the app's splash must not
//start its clock before the OS splash is gone. Both halves used to be wrong in the
//same direction — the splash's minimum visible time was spent under the OS splash.

const mocks = vi.hoisted(() => {
  let hold = Promise.resolve()
  let release: () => void = () => {}
  return {
    hideNativeSplash: vi.fn(() => Promise.resolve()),
    firstLaunchHold: vi.fn(() => hold),
    /** Put a first-launch OTA wait in front of the handoff, like a real cold start. */
    pendHold() {
      hold = new Promise<void>((resolve) => {
        release = resolve
      })
    },
    releaseHold() {
      release()
    },
    resolveHold() {
      hold = Promise.resolve()
    },
  }
})

vi.mock("#adaptv/capabilities/splash", () => ({
  hideNativeSplash: mocks.hideNativeSplash,
}))
vi.mock("#adaptv/ota/updater", () => ({
  firstLaunchHold: mocks.firstLaunchHold,
}))

let frames: Array<() => void> = []

beforeEach(() => {
  frames = []
  //hand-driven frames: the two-frame paint gate is only observable if the test
  //decides when a frame runs
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) =>
    frames.push(cb),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  mocks.resolveHold()
  document.documentElement.removeAttribute(SPLASH_REVEALED_ATTR)
})

/** Run the frames that are currently queued (a callback may queue the next one). */
async function paint() {
  const due = frames
  frames = []
  await act(async () => {
    for (const frame of due) frame()
  })
}

describe("useSplashHandoff", () => {
  it("reports nothing until the OS splash is off", async () => {
    const { result } = renderHook(() => useSplashHandoff())

    expect(result.current).toBeNull()
    await paint()
    await paint()
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toBeGreaterThan(0)
  })

  it("keeps the OS splash up until a frame has actually painted", async () => {
    renderHook(() => useSplashHandoff())
    await act(async () => {})

    //one frame is not enough: that callback runs BEFORE the paint it precedes, so
    //hiding there would take the OS splash off an unpainted WebView — the white
    //flash `launchAutoHide: false` exists to prevent
    await paint()
    expect(mocks.hideNativeSplash).not.toHaveBeenCalled()

    await paint()
    await waitFor(() =>
      expect(mocks.hideNativeSplash).toHaveBeenCalledOnce(),
    )
  })

  it("stamps <html> on the same tick it reports the reveal", async () => {
    const { result } = renderHook(() => useSplashHandoff())

    expect(
      document.documentElement.hasAttribute(SPLASH_REVEALED_ATTR),
    ).toBe(false)

    await paint()
    await paint()
    await waitFor(() => expect(result.current).not.toBeNull())
    //the CSS hold on the splash's animations lifts from this attribute, so a frame
    //where the clock has started but the animations are still frozen is a bug
    expect(
      document.documentElement.hasAttribute(SPLASH_REVEALED_ATTR),
    ).toBe(true)
  })

  it("waits out a first launch that is still deciding which bundle to show", async () => {
    mocks.pendHold()
    const { result } = renderHook(() => useSplashHandoff())

    await act(async () => {})
    await paint()
    await paint()
    //the wait is spent under the OS splash on purpose (§5.4a) — revealing here would
    //show a splash that the bundle swap's reload() is about to tear down
    expect(mocks.hideNativeSplash).not.toHaveBeenCalled()
    expect(result.current).toBeNull()

    await act(async () => {
      mocks.releaseHold()
    })
    await paint()
    await paint()
    await waitFor(() => expect(result.current).not.toBeNull())
  })

  it("hands off anyway when frames never run", async () => {
    vi.useFakeTimers()
    try {
      //a WebView that never fires a frame callback while an opaque native view
      //covers it would otherwise never launch at all
      vi.stubGlobal("requestAnimationFrame", () => 0)
      const { result } = renderHook(() => useSplashHandoff())

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(mocks.hideNativeSplash).toHaveBeenCalledOnce()
      expect(result.current).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
