import { renderHook, waitFor } from "@testing-library/react"
import {
  afterEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest"
import { useManifestOrientation } from "#adaptv/hooks/use-manifest-orientation"

afterEach(() => {
  vi.unstubAllGlobals()
})

//the load runs detached (`void load()`), so a throw inside it is nobody's
//error but the runtime's: collect what escapes instead of letting it vanish
function collectUnhandledRejections(): unknown[] {
  const escaped: unknown[] = []
  const onRejection = (reason: unknown) => escaped.push(reason)
  process.on("unhandledRejection", onRejection)
  onTestFinished(() => {
    process.off("unhandledRejection", onRejection)
  })
  return escaped
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe("useManifestOrientation", () => {
  it("mirrors a portrait manifest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ orientation: "portrait-primary" }),
      })),
    )
    const { result } = renderHook(() =>
      useManifestOrientation("/manifest.webmanifest"),
    )
    await waitFor(() => expect(result.current).toBe("portrait"))
  })

  it("stays off when the fetch rejects with an Error", async () => {
    const escaped = collectUnhandledRejections()
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    )
    const { result } = renderHook(() =>
      useManifestOrientation("/manifest.webmanifest"),
    )
    await settle()
    expect(result.current).toBe("any")
    expect(escaped).toEqual([])
  })

  it("stays off, without a stray TypeError, when the fetch rejects with no reason", async () => {
    const escaped = collectUnhandledRejections()
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject()),
    )
    const { result } = renderHook(() =>
      useManifestOrientation("/manifest.webmanifest"),
    )
    await settle()
    expect(result.current).toBe("any")
    //on the old reading the empty error slot looked like success, and
    //`manifest.orientation` was read off null
    expect(escaped).toEqual([])
  })
})
