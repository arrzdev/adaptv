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

  it("with nothing subscribed, announce asks the OS rather than trusting a stale read", async () => {
    native()
    vi.mocked(ScreenReader.isEnabled).mockResolvedValue({ value: false })
    expect(await announce("Saved")).toBe("silent")
    expect(getScreenReaderState().status).toBe("off")
    //the reader is switched on with no subscriber to hear the stateChange
    vi.mocked(ScreenReader.isEnabled).mockResolvedValue({ value: true })
    expect(await announce("Saved")).toBe("announced")
    expect(ScreenReader.speak).toHaveBeenCalledWith({
      value: "Saved",
      language: undefined,
    })
  })

  it("while subscribed, announce trusts the live snapshot", async () => {
    native()
    vi.mocked(ScreenReader.isEnabled).mockResolvedValue({ value: true })
    const off = subscribeScreenReader(() => {})
    await flush()
    vi.mocked(ScreenReader.isEnabled).mockClear()
    expect(await announce("Saved")).toBe("announced")
    expect(ScreenReader.isEnabled).not.toHaveBeenCalled()
    off()
  })

  it("a binary built before the plugin reads unknown and cannot announce", async () => {
    native(false)
    expect(await readScreenReader()).toEqual({ status: "unknown" })
    expect(await announce("Saved")).toBe("unsupported")
    expect(ScreenReader.isEnabled).not.toHaveBeenCalled()
  })

  it("removes a listener whose handle arrives after the last unsubscribe", async () => {
    //the bridge answers asynchronously, so a subscriber can leave first —
    //useSyncExternalStore under StrictMode always does in dev. The handle that
    //arrives afterwards belongs to nobody and must remove itself.
    native()
    let resolveHandle: (h: { remove: () => Promise<void> }) => void =
      () => {}
    vi.mocked(ScreenReader.addListener).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHandle = resolve
        }),
    )
    subscribeScreenReader(() => {})()
    const late = vi.fn(async () => {})
    resolveHandle({ remove: late })
    await flush()
    expect(late).toHaveBeenCalledTimes(1)
  })

  it("binds again for the next subscriber, and a stale handle never stands in for the live one", async () => {
    native()
    const handles: Array<(h: { remove: () => Promise<void> }) => void> = []
    const pending = () =>
      new Promise<{ remove: () => Promise<void> }>((resolve) =>
        handles.push(resolve),
      )
    vi.mocked(ScreenReader.addListener)
      .mockImplementationOnce(pending)
      .mockImplementationOnce(pending)
    subscribeScreenReader(() => {})()
    const off = subscribeScreenReader(() => {})
    expect(ScreenReader.addListener).toHaveBeenCalledTimes(2)

    //the live handle lands first, the stale one after it
    const live = vi.fn(async () => {})
    const stale = vi.fn(async () => {})
    handles[1]?.({ remove: live })
    handles[0]?.({ remove: stale })
    await flush()
    expect(stale).toHaveBeenCalledTimes(1)
    expect(live).not.toHaveBeenCalled()

    off()
    expect(live).toHaveBeenCalledTimes(1)
    expect(unResume).toHaveBeenCalledTimes(2)
  })

  it("a subscriber that throws surfaces its error and does not turn the OS's answer into unknown", async () => {
    native()
    const offQuiet = subscribeScreenReader(() => {})
    await flush()
    const boom = new Error("subscriber")
    const offLoud = subscribeScreenReader(() => {
      throw boom
    })
    try {
      vi.mocked(ScreenReader.isEnabled).mockResolvedValue({ value: true })
      await expect(readScreenReader()).rejects.toBe(boom)
      expect(getScreenReaderState().status).toBe("on")
    } finally {
      offLoud()
      offQuiet()
    }
  })

  it("a plugin that rejects on read is unknown, not off", async () => {
    native()
    vi.mocked(ScreenReader.isEnabled).mockRejectedValue(
      new Error("bridge"),
    )
    expect(await readScreenReader()).toEqual({ status: "unknown" })
  })
})

/**
 * A fresh accessor over a stand-in plugin. The native binding is a process
 * singleton, so each test gets its own module; the stand-in is built of plain
 * functions, not `vi.fn`, because a spy attaches its own handler to every promise
 * it returns and so hides exactly the rejection these tests look for.
 */
async function nativeScreenReader(plugin: Record<string, unknown>) {
  vi.resetModules()
  vi.doMock("@capacitor/screen-reader", () => ({ ScreenReader: plugin }))
  vi.doMock("#adaptv/utils/platform", () => ({
    isNativePlatform: () => true,
  }))
  vi.doMock("#adaptv/utils/native-plugins", () => ({
    hasNativePlugin: () => true,
  }))
  vi.doMock("#adaptv/capabilities/app-state", () => ({
    onResume: () => () => {},
  }))
  return import("#adaptv/capabilities/screen-reader")
}

/** Every rejection nobody handled while `run` executed, read after the turn ends. */
async function unhandledDuring(run: () => void): Promise<unknown[]> {
  const seen: unknown[] = []
  const listener = (reason: unknown) => seen.push(reason)
  process.on("unhandledRejection", listener)
  try {
    run()
    //Node decides a rejection went unhandled only once the microtask queue has
    //drained, so leave the turn (twice: a rejection can be chained) before reading
    await flush()
    await flush()
  } finally {
    process.off("unhandledRejection", listener)
  }
  return seen
}

const rejectWith = (message: string) => () =>
  Promise.reject(new Error(message))

describe("screen reader — native, over a bridge that fails", () => {
  afterEach(() => {
    for (const id of [
      "@capacitor/screen-reader",
      "#adaptv/utils/platform",
      "#adaptv/utils/native-plugins",
      "#adaptv/capabilities/app-state",
    ])
      vi.doUnmock(id)
    vi.resetModules()
  })

  it("lets no rejected read, addListener or handle removal escape", async () => {
    const reject = rejectWith("ScreenReader plugin is not implemented")
    const { subscribeScreenReader, getScreenReaderState } =
      await nativeScreenReader({ isEnabled: reject, addListener: reject })
    let off = () => {}
    expect(
      await unhandledDuring(() => {
        off = subscribeScreenReader(() => {})
      }),
    ).toEqual([])
    expect(getScreenReaderState().status).toBe("unknown")
    expect(await unhandledDuring(() => off())).toEqual([])

    const removing = await nativeScreenReader({
      isEnabled: () => Promise.resolve({ value: false }),
      addListener: () =>
        Promise.resolve({ remove: rejectWith("bridge: remove failed") }),
    })
    const offLate = removing.subscribeScreenReader(() => {})
    await flush()
    expect(await unhandledDuring(offLate)).toEqual([])
  })
})
