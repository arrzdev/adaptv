import { ScreenReader } from "@capacitor/screen-reader"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { onResume } from "#adaptv/capabilities/app-state"
import {
  announce,
  getScreenReaderState,
  readScreenReader,
  subscribeScreenReader,
} from "#adaptv/capabilities/screen-reader"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isNativePlatform } from "#adaptv/utils/platform"

type StateListener = (s: { value: boolean }) => void
let stateListener: StateListener | null = null
const remove = vi.fn(async () => {})

vi.mock("@capacitor/screen-reader", () => ({
  ScreenReader: {
    isEnabled: vi.fn(async () => ({ value: false })),
    speak: vi.fn(async () => {}),
    addListener: vi.fn(async (_name: string, cb: StateListener) => {
      stateListener = cb
      return { remove }
    }),
  },
}))

let resumeCb: (() => void) | null = null
const unResume = vi.fn()
vi.mock("#adaptv/capabilities/app-state", () => ({
  onResume: vi.fn((cb: () => void) => {
    resumeCb = cb
    return unResume
  }),
}))

vi.mock("#adaptv/utils/platform", () => ({
  isNativePlatform: vi.fn(() => false),
}))
vi.mock("#adaptv/utils/native-plugins", () => ({
  hasNativePlugin: vi.fn(() => true),
}))

function native(plugin = true) {
  vi.mocked(isNativePlatform).mockReturnValue(true)
  vi.mocked(hasNativePlugin).mockReturnValue(plugin)
}

const flush = () => new Promise((r) => setTimeout(r, 5))

beforeEach(() => {
  vi.mocked(isNativePlatform).mockReturnValue(false)
  vi.mocked(hasNativePlugin).mockReturnValue(true)
  vi.mocked(ScreenReader.isEnabled).mockResolvedValue({ value: false })
  vi.mocked(ScreenReader.speak).mockResolvedValue()
  stateListener = null
  resumeCb = null
})

afterEach(async () => {
  //drop the module back to unknown between tests, through the same door a consumer uses
  vi.mocked(isNativePlatform).mockReturnValue(false)
  await readScreenReader()
  vi.clearAllMocks()
  document.body.innerHTML = ""
})

describe("screen reader — the web", () => {
  it("reads unknown, follows nothing, and never touches the plugin", async () => {
    expect(getScreenReaderState().status).toBe("unknown")
    const cb = vi.fn()
    const off = subscribeScreenReader(cb)
    expect(await readScreenReader()).toEqual({ status: "unknown" })
    expect(cb).not.toHaveBeenCalled()
    expect(ScreenReader.isEnabled).not.toHaveBeenCalled()
    expect(ScreenReader.addListener).not.toHaveBeenCalled()
    expect(onResume).not.toHaveBeenCalled()
    off()
  })

  it("announces through one polite live region, cleared then filled so a repeat is a new mutation", async () => {
    expect(await announce("Saved")).toBe("announced")
    const regions = document.querySelectorAll("[data-adaptv-announcer]")
    expect(regions).toHaveLength(1)
    const el = regions[0] as HTMLElement
    expect(el.getAttribute("role")).toBe("status")
    expect(el.getAttribute("aria-live")).toBe("polite")
    expect(el.textContent).toBe("Saved")
    const p = announce("Saved", { language: "pt" })
    expect(el.textContent).toBe("")
    expect(await p).toBe("announced")
    expect(el.textContent).toBe("Saved")
    expect(el.lang).toBe("pt")
    expect(
      document.querySelectorAll("[data-adaptv-announcer]"),
    ).toHaveLength(1)
    expect(ScreenReader.speak).not.toHaveBeenCalled()
  })
})

describe("screen reader — native", () => {
  it("reads the OS's answer, follows stateChange, re-reads on resume, and releases after the last subscriber", async () => {
    native()
    vi.mocked(ScreenReader.isEnabled).mockResolvedValue({ value: true })
    const cb = vi.fn()
    const off = subscribeScreenReader(cb)
    await flush()
    expect(getScreenReaderState().status).toBe("on")
    expect(cb).toHaveBeenCalledTimes(1)
    expect(ScreenReader.addListener).toHaveBeenCalledWith(
      "stateChange",
      expect.any(Function),
    )
    stateListener?.({ value: false })
    expect(getScreenReaderState().status).toBe("off")
    expect(cb).toHaveBeenCalledTimes(2)
    stateListener?.({ value: false })
    expect(cb).toHaveBeenCalledTimes(2)
    vi.mocked(ScreenReader.isEnabled).mockResolvedValue({ value: true })
    resumeCb?.()
    await flush()
    expect(getScreenReaderState().status).toBe("on")
    off()
    expect(remove).toHaveBeenCalledTimes(1)
    expect(unResume).toHaveBeenCalledTimes(1)
  })

  it("announces only while a reader is on, and a plugin failure is silent", async () => {
    native()
    vi.mocked(ScreenReader.isEnabled).mockResolvedValue({ value: false })
    expect(await announce("Saved")).toBe("silent")
    expect(ScreenReader.speak).not.toHaveBeenCalled()
    vi.mocked(ScreenReader.isEnabled).mockResolvedValue({ value: true })
    await readScreenReader()
    expect(await announce("Saved", { language: "en" })).toBe("announced")
    expect(ScreenReader.speak).toHaveBeenCalledWith({
      value: "Saved",
      language: "en",
    })
    vi.mocked(ScreenReader.speak).mockRejectedValue(new Error("bridge"))
    expect(await announce("Saved")).toBe("silent")
    expect(document.querySelector("[data-adaptv-announcer]")).toBeNull()
  })

  it("a binary built before the plugin reads unknown and cannot announce", async () => {
    native(false)
    expect(await readScreenReader()).toEqual({ status: "unknown" })
    expect(await announce("Saved")).toBe("unsupported")
    expect(ScreenReader.isEnabled).not.toHaveBeenCalled()
  })

  it("a plugin that rejects on read is unknown, not off", async () => {
    native()
    vi.mocked(ScreenReader.isEnabled).mockRejectedValue(
      new Error("bridge"),
    )
    expect(await readScreenReader()).toEqual({ status: "unknown" })
  })
})
