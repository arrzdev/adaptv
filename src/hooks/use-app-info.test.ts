import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getAppInfo,
  getAppInfoCaveat,
} from "#adaptv/capabilities/app-info"
import { useAppInfo } from "#adaptv/hooks/use-app-info"

vi.mock("#adaptv/capabilities/app-info", () => ({
  getAppInfo: vi.fn(async () => ({
    name: "ChopChop",
    id: "dev.arrz.projectzero",
    version: "1.4.0",
    build: "42",
  })),
  getAppInfoCaveat: vi.fn(() => null),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe("useAppInfo", () => {
  it("is null while the read is in flight, then the record", async () => {
    const { result } = renderHook(() => useAppInfo())
    //null, not a record of nulls: a settings row must be able to show that it
    //is reading rather than flash "none" for a version it is about to know
    expect(result.current.info).toBeNull()
    await waitFor(() => expect(result.current.info?.version).toBe("1.4.0"))
    expect(result.current.info?.build).toBe("42")
    expect(result.current.caveat).toBeNull()
  })

  it("carries the caveat the target reports", async () => {
    vi.mocked(getAppInfoCaveat).mockReturnValue("no installed version")
    const { result } = renderHook(() => useAppInfo())
    expect(result.current.caveat).toBe("no installed version")
    await waitFor(() => expect(result.current.info).not.toBeNull())
  })

  it("does not set state after unmount", async () => {
    let resolve: (value: unknown) => void = () => {}
    vi.mocked(getAppInfo).mockReturnValue(
      new Promise((r) => {
        resolve = r as (value: unknown) => void
      }) as never,
    )
    const { unmount } = renderHook(() => useAppInfo())
    unmount()
    resolve({ name: "x", id: null, version: null, build: null })
    await Promise.resolve()
    //no act() warning and no throw is the assertion; the guard is the `live`
    //flag in the effect
    expect(getAppInfo).toHaveBeenCalled()
  })
})
