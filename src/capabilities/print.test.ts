import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getPrintStatus,
  isPrinting,
  PRINT_DIALOG_MAX_MS,
  print,
  resetPrint,
  subscribePrint,
} from "#adaptv/capabilities/print"
import { isNativePlatform } from "#adaptv/utils/platform"

vi.mock("#adaptv/utils/platform", () => ({
  isNativePlatform: vi.fn(() => false),
}))

//The engine under test: `window.print` fires the events the real one would, or
//none, or throws — one fake per measured behaviour.
type Engine = "dialog" | "headless-chromium" | "silent" | "throws"

function installPrint(engine: Engine) {
  vi.stubGlobal("print", () => {
    if (engine === "throws") throw new Error("no printer")
    if (engine === "silent") return
    window.dispatchEvent(new Event("beforeprint"))
    if (engine === "headless-chromium") {
      window.dispatchEvent(new Event("afterprint"))
      return
    }
    //A real dialog: `afterprint` comes later, when the user closes it.
    setTimeout(() => window.dispatchEvent(new Event("afterprint")), 5000)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(isNativePlatform).mockReturnValue(false)
  resetPrint()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("print — status", () => {
  it("is available where window.print exists off native", () => {
    installPrint("dialog")
    expect(getPrintStatus()).toBe("available")
  })

  it("is unsupported inside a native WebView, even with window.print present", () => {
    installPrint("dialog")
    vi.mocked(isNativePlatform).mockReturnValue(true)
    expect(getPrintStatus()).toBe("unsupported")
  })

  it("is unsupported without window.print", () => {
    vi.stubGlobal("print", undefined)
    expect(getPrintStatus()).toBe("unsupported")
  })
})

describe("print — outcomes", () => {
  it("reads a dialog that opened and closed as opened, and waits for it", async () => {
    installPrint("dialog")
    const seen: boolean[] = []
    subscribePrint(() => seen.push(isPrinting()))
    const p = print()
    expect(isPrinting()).toBe(true)
    //Past the silent wait: `beforeprint` fired, so the dialog is up and counts.
    await vi.advanceTimersByTimeAsync(3000)
    expect(isPrinting()).toBe(true)
    await vi.advanceTimersByTimeAsync(2500)
    expect(await p).toBe("opened")
    expect(seen).toEqual([true, false])
  })

  it("reads both events firing synchronously as opened", async () => {
    installPrint("headless-chromium")
    expect(await print()).toBe("opened")
    expect(isPrinting()).toBe(false)
  })

  it("reads no event within the wait as silent", async () => {
    installPrint("silent")
    const p = print({ silentAfterMs: 200 })
    await vi.advanceTimersByTimeAsync(199)
    expect(isPrinting()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toBe("silent")
    expect(isPrinting()).toBe(false)
  })

  it("calls window.print again after a call that settled inside window.print itself", async () => {
    //Headless Chromium, and every engine whose dialog blocks the call, fire
    //`afterprint` before `window.print()` returns.
    const spy = vi.fn(() => {
      window.dispatchEvent(new Event("beforeprint"))
      window.dispatchEvent(new Event("afterprint"))
    })
    vi.stubGlobal("print", spy)
    expect(await print()).toBe("opened")
    expect(await print()).toBe("opened")
    expect(spy).toHaveBeenCalledTimes(2)
    expect(isPrinting()).toBe(false)
  })

  it("reads a throw as failed", async () => {
    installPrint("throws")
    expect(await print()).toBe("failed")
    expect(isPrinting()).toBe(false)
  })

  it("never calls window.print on an unsupported target", async () => {
    const spy = vi.fn()
    vi.stubGlobal("print", spy)
    vi.mocked(isNativePlatform).mockReturnValue(true)
    expect(await print()).toBe("unsupported")
    expect(spy).not.toHaveBeenCalled()
  })

  it.each([
    ["pointerdown", () => window.dispatchEvent(new Event("pointerdown"))],
    ["keydown", () => window.dispatchEvent(new Event("keydown"))],
    ["focus", () => window.dispatchEvent(new Event("focus"))],
    [
      "visibilitychange",
      () => document.dispatchEvent(new Event("visibilitychange")),
    ],
  ])(
    "settles a dialog whose afterprint never comes on the user's return (%s)",
    async (_, back) => {
      vi.stubGlobal("print", () => {
        window.dispatchEvent(new Event("beforeprint"))
      })
      const p = print()
      //the silent wait is over and the dialog counts as up
      await vi.advanceTimersByTimeAsync(3000)
      expect(isPrinting()).toBe(true)
      back()
      expect(await p).toBe("opened")
      expect(isPrinting()).toBe(false)
    },
  )

  it("settles a dialog whose afterprint never comes at the upper bound, and the next call opens again", async () => {
    const spy = vi.fn(() => {
      window.dispatchEvent(new Event("beforeprint"))
    })
    vi.stubGlobal("print", spy)
    const p = print()
    await vi.advanceTimersByTimeAsync(PRINT_DIALOG_MAX_MS - 1)
    expect(isPrinting()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toBe("opened")
    expect(isPrinting()).toBe(false)
    const again = print()
    expect(again).not.toBe(p)
    expect(spy).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(PRINT_DIALOG_MAX_MS)
    expect(await again).toBe("opened")
  })

  it("does not count the user's input before any dialog opened as a return", async () => {
    installPrint("silent")
    const p = print({ silentAfterMs: 200 })
    window.dispatchEvent(new Event("pointerdown"))
    await vi.advanceTimersByTimeAsync(199)
    expect(isPrinting()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toBe("silent")
  })

  it("shares one in-flight call between two callers", async () => {
    const spy = vi.fn(() => {
      window.dispatchEvent(new Event("beforeprint"))
      setTimeout(() => window.dispatchEvent(new Event("afterprint")), 50)
    })
    vi.stubGlobal("print", spy)
    const a = print()
    const b = print()
    expect(b).toBe(a)
    await vi.advanceTimersByTimeAsync(60)
    expect(await a).toBe("opened")
    expect(spy).toHaveBeenCalledTimes(1)
    //And a later call opens again.
    const c = print()
    await vi.advanceTimersByTimeAsync(60)
    expect(await c).toBe("opened")
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
