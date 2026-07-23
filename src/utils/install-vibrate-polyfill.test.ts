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

  it("does nothing at all on iOS Safari, which has no vibrate to wrap", async () => {
    //This is the branch that used to mount a hidden <input type="checkbox" switch>
    //and drive it with .click(). Apple patched programmatic triggering in iOS 26.5,
    //so that code fired nothing while still *reporting success* — the worst
    //possible failure shape. It is gone; the real mechanism now lives in
    //haptic-tick.ts and needs a genuine finger.
    //
    //The UA stub matters: without it happy-dom is not detected as Safari and this
    //test would pass without ever reaching the branch it exists to guard.
    const prevUA = Object.getOwnPropertyDescriptor(navigator, "userAgent")
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 Version/26.5 Safari/605.1.15",
      configurable: true,
    })
    restores.push(() => {
      if (prevUA) Object.defineProperty(navigator, "userAgent", prevUA)
    })

    setVibrate(undefined)
    await freshInstall()

    expect(navigator.vibrate).toBeUndefined()
    expect(document.querySelector("input[switch]")).toBeNull()
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
