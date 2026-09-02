import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getPrintStatus,
  isPrinting,
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
