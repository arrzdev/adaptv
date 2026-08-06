import { afterEach, describe, expect, it, vi } from "vitest"

const restores: Array<() => void> = []

function setVibrate(value: unknown): void {
  const prev = Object.getOwnPropertyDescriptor(navigator, "vibrate")
  Object.defineProperty(navigator, "vibrate", {
    value,
    configurable: true,
    writable: true,
  })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, "vibrate", prev)
    else delete (navigator as { vibrate?: unknown }).vibrate
  })
}

afterEach(() => {
  for (const r of restores.splice(0)) r()
  //the iOS branch mounts a hidden <label><input switch></label> in <head> — clear it
  for (const el of document.querySelectorAll("input[switch]"))
    (el.closest("label") ?? el).remove()
  vi.resetModules()
})

/**
 * The module memoises installation in a module-scoped flag, so each test needs a
 * fresh instance — and must keep hold of *that* instance's export, since a
 * statically-imported one would carry its own independent flag.
 */
async function freshInstall() {
  vi.resetModules()
  const mod = await import("#adaptv/utils/install-vibrate-polyfill")
  mod.installVibratePolyfill()
  return mod
}

describe("installVibratePolyfill — cancel-then-vibrate wrapper", () => {
  it("cancels an in-flight pattern before starting a new one", async () => {
    //without this, overlapping calls queue up and the device buzzes for far
    //longer than any single call requested
    const native = vi.fn(() => true)
    setVibrate(native)
    await freshInstall()

    navigator.vibrate(30)
    expect(native).toHaveBeenNthCalledWith(1, 0)
    expect(native).toHaveBeenNthCalledWith(2, 30)
  })

  it("treats 0 and [] as pure cancels, never as a pulse", async () => {
    const native = vi.fn(() => true)
    setVibrate(native)
    await freshInstall()

    navigator.vibrate(0)
    navigator.vibrate([])
    expect(native).toHaveBeenCalledTimes(2)
    expect(native).toHaveBeenNthCalledWith(1, 0)
    expect(native).toHaveBeenNthCalledWith(2, 0)
  })

  it("normalises a non-array iterable into an array", async () => {
    //the spec accepts any iterable; the underlying implementations do not
    const native = vi.fn(() => true)
    setVibrate(native)
    await freshInstall()

    navigator.vibrate(new Set([10, 20, 30]))
    expect(native).toHaveBeenLastCalledWith([10, 20, 30])
  })

  it("on iOS 18+ Safari, mounts the switch transducer and clicks the label per pulse", async () => {
    //iOS Safari has no navigator.vibrate, so the shim reaches the Taptic Engine by
    //toggling a native <input switch> — driven by clicking its wrapping <label> (the
    //label activation is what fires the tick; the switch keeps its native appearance,
    //which is required, so the whole label is hidden with display:none instead).
    //⚠ Apple patched programmatic triggering in iOS 26.5, so on 26.5+ the click fires
    //no haptic while still reporting success — accepted, and undetectable at runtime.
    //
    //The UA stub matters: getSafariVersion() gates on Safari ≥ 18 from the UA.
    const prevUA = Object.getOwnPropertyDescriptor(navigator, "userAgent")
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      configurable: true,
    })
    restores.push(() => {
      if (prevUA) Object.defineProperty(navigator, "userAgent", prevUA)
    })

    setVibrate(undefined)
    await freshInstall()

    //a vibrate function now exists and a hidden <label><input switch></label> is in <head>
    expect(typeof navigator.vibrate).toBe("function")
    const sw = document.querySelector("input[switch]")
    expect(sw).not.toBeNull()
    const label = sw?.closest("label")
    expect(label).not.toBeNull()
    expect(label?.parentElement).toBe(document.head)

    //a pulse clicks the label; a cancel (0) does not
    const click = vi.spyOn(label as HTMLLabelElement, "click")
    navigator.vibrate(20)
    expect(click).toHaveBeenCalledTimes(1)
    navigator.vibrate(0)
    expect(click).toHaveBeenCalledTimes(1)
  })

  it("installs once, even if called repeatedly", async () => {
    const native = vi.fn(() => true)
    setVibrate(native)
    const mod = await freshInstall()

    const wrapped = navigator.vibrate
    mod.installVibratePolyfill()
    expect(navigator.vibrate).toBe(wrapped)
  })
})
