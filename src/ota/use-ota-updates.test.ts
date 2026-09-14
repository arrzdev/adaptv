import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/*
 * The hook is the only place the two halves of OTA are wired, and losing either
 * one is silent: without `settleLaunch` every update rolls itself back a launch
 * later, and without `startOtaUpdates` nothing is ever staged. So both are pinned
 * here, with exactly the options the build resolved.
 */

const h = vi.hoisted(() => ({
  config: null as unknown,
  stop: vi.fn(),
  settleLaunch: vi.fn(async () => {}),
  startOtaUpdates: vi.fn(),
}))

vi.mock("virtual:adaptv/ota-config", () => ({
  get otaConfig() {
    return h.config
  },
}))

vi.mock("#adaptv/ota/updater", () => ({
  settleLaunch: h.settleLaunch,
  startOtaUpdates: h.startOtaUpdates,
}))

const { useOtaUpdates } = await import("#adaptv/ota/use-ota-updates")

const config = {
  manifestUrl: "https://app.example/.well-known/adaptv/ota/manifest.json",
  nativeFingerprint: "fp-app",
  nativeSkew: "refuse",
  //every value off its default, so a field hard-coded in the hook cannot match
  //by accident
  requireSignature: false,
  publicKey: "-----BEGIN PUBLIC KEY-----\nkey\n-----END PUBLIC KEY-----",
  pollIntervalMs: 900_000,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.config = config
  h.startOtaUpdates.mockReturnValue(h.stop)
})

describe("useOtaUpdates", () => {
  it("settles the launch against the fingerprint the build resolved", () => {
    //Dropping this call does not disable the watchdog, it INVERTS it.
    renderHook(() => useOtaUpdates())
    expect(h.settleLaunch).toHaveBeenCalledOnce()
    expect(h.settleLaunch).toHaveBeenCalledWith({
      nativeFingerprint: "fp-app",
    })
  })

  it("starts the update loop with every option the build resolved", () => {
    //Field by field: a dropped one does not fail, it quietly takes its default,
    //and the default of `nativeSkew` and `pollIntervalMs` is not what was asked.
    renderHook(() => useOtaUpdates())
    expect(h.startOtaUpdates).toHaveBeenCalledOnce()
    expect(h.startOtaUpdates).toHaveBeenCalledWith(config)
  })

  it("runs once per mount, not once per render", () => {
    //The shell re-renders for reasons of its own. An effect that re-ran would
    //ping the watchdog again and start a second update loop beside the first.
    const { rerender } = renderHook(() => useOtaUpdates())
    rerender()
    rerender()
    expect(h.settleLaunch).toHaveBeenCalledOnce()
    expect(h.startOtaUpdates).toHaveBeenCalledOnce()
    expect(h.stop).not.toHaveBeenCalled()
  })

  it("tears the loop down with the component", () => {
    const { unmount } = renderHook(() => useOtaUpdates())
    expect(h.stop).not.toHaveBeenCalled()
    unmount()
    expect(h.stop).toHaveBeenCalledOnce()
  })

  it("does nothing at all when the build has OTA off", () => {
    h.config = null
    const { unmount } = renderHook(() => useOtaUpdates())
    unmount()
    expect(h.settleLaunch).not.toHaveBeenCalled()
    expect(h.startOtaUpdates).not.toHaveBeenCalled()
  })
})
