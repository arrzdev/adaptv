import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  checkClipboardReadPermission,
  isClipboardReadSupported,
  isClipboardWriteSupported,
  readClipboardText,
  writeClipboardText,
} from "#adaptv/capabilities/clipboard"
import { useClipboard } from "#adaptv/hooks/use-clipboard"

vi.mock("#adaptv/capabilities/clipboard", () => ({
  isClipboardWriteSupported: vi.fn(() => true),
  isClipboardReadSupported: vi.fn(() => true),
  checkClipboardReadPermission: vi.fn(() => Promise.resolve("granted")),
  writeClipboardText: vi.fn(() => Promise.resolve("ok")),
  readClipboardText: vi.fn(() =>
    Promise.resolve({ status: "ok", text: "pasted" }),
  ),
}))

//`clearAllMocks` clears calls but keeps implementations, so each test restates
//the defaults it is deviating from — otherwise one test's `mockReturnValue`
//leaks into the next and the failure reads as a bug in the hook
beforeEach(() => {
  vi.mocked(isClipboardWriteSupported).mockReturnValue(true)
  vi.mocked(isClipboardReadSupported).mockReturnValue(true)
  vi.mocked(checkClipboardReadPermission).mockResolvedValue("granted")
  vi.mocked(writeClipboardText).mockResolvedValue("ok")
  vi.mocked(readClipboardText).mockResolvedValue({
    status: "ok",
    text: "pasted",
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("useClipboard", () => {
  it("keeps the read and write gaps separate", async () => {
    //an insecure origin can copy but not paste; one flag would have to lie
    vi.mocked(isClipboardWriteSupported).mockReturnValue(true)
    vi.mocked(isClipboardReadSupported).mockReturnValue(false)
    vi.mocked(checkClipboardReadPermission).mockResolvedValue(
      "unavailable",
    )

    const { result } = renderHook(() => useClipboard())

    await waitFor(() => expect(result.current.canWrite).toBe(true))
    expect(result.current.canRead).toBe(false)
    await waitFor(() =>
      expect(result.current.readPermission).toBe("unavailable"),
    )
  })

  it("surfaces a denied copy as status, never as a rejection", async () => {
    vi.mocked(writeClipboardText).mockResolvedValueOnce("denied")
    const { result } = renderHook(() => useClipboard())

    await act(async () => {
      await result.current.copy("hi")
    })

    expect(result.current.status).toBe("denied")
  })

  it("returns null text and a denied status for a refused paste", async () => {
    vi.mocked(readClipboardText).mockResolvedValueOnce({
      status: "denied",
      text: null,
    })
    const { result } = renderHook(() => useClipboard())

    let returned: unknown
    await act(async () => {
      returned = await result.current.paste()
    })

    expect(returned).toBeNull()
    expect(result.current.status).toBe("denied")
    expect(result.current.text).toBeNull()
  })

  it("re-reads the permission after a paste", async () => {
    //Chromium only flips clipboard-read to "granted" once a read has actually
    //happened, so the read itself is the most accurate probe there is
    const { result } = renderHook(() => useClipboard())
    await waitFor(() => expect(result.current.canRead).toBe(true))
    vi.mocked(checkClipboardReadPermission).mockClear()

    await act(async () => {
      await result.current.paste()
    })

    expect(checkClipboardReadPermission).toHaveBeenCalled()
    expect(result.current.text).toBe("pasted")
  })
})
