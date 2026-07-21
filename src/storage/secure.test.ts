import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { secure } from "#nativ/storage/secure"

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe("secure — web is best-effort, and says so", () => {
  it("round-trips a value", async () => {
    vi.stubGlobal("Capacitor", undefined)
    await secure.set("token", "abc")
    expect(await secure.get("token")).toBe("abc")
  })

  it("resolves undefined for an absent key", async () => {
    vi.stubGlobal("Capacitor", undefined)
    expect(await secure.get("nope")).toBeUndefined()
  })

  it("removes a value", async () => {
    vi.stubGlobal("Capacitor", undefined)
    await secure.set("token", "abc")
    await secure.remove("token")
    expect(await secure.get("token")).toBeUndefined()
  })

  it("reports that web storage is NOT hardware-backed", async () => {
    //this must never claim otherwise: there is no browser API that hides a value
    //from JS on the same origin, so any XSS reads it. Calling it "secure" without
    //this escape hatch would shape how people use it, wrongly.
    vi.stubGlobal("Capacitor", undefined)
    expect(secure.isHardwareBacked()).toBe(false)
  })

  it("namespaces its keys away from the kv tier", async () => {
    vi.stubGlobal("Capacitor", undefined)
    await secure.set("token", "abc")
    expect(localStorage.getItem("nativ:secure:token")).toBe("abc")
    expect(localStorage.getItem("nativ:kv:token")).toBeNull()
  })

  it("throws rather than silently losing a secret it could not persist", async () => {
    //asymmetric on purpose: `get`/`remove` degrade quietly, but a `set` that
    //silently failed logs the user out on next load with no explanation
    vi.stubGlobal("Capacitor", undefined)
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem() {
        throw new Error("QuotaExceededError")
      },
      removeItem() {},
    })
    await expect(secure.set("token", "abc")).rejects.toThrow()
  })
})

describe("secure — native", () => {
  it("reports hardware backing", async () => {
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true })
    expect(secure.isHardwareBacked()).toBe(true)
  })

  it("fails loudly when the plugin is missing, naming the fix", async () => {
    //never fall back to localStorage on native: that would put a token in
    //plaintext on a device while the API name promises the Keychain
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true })
    await expect(secure.get("token")).rejects.toThrow(
      /capacitor-secure-storage/,
    )
  })

  it("does not offer @capacitor/preferences as the fallback", async () => {
    //B23: Preferences is plaintext (UserDefaults / SharedPreferences), so
    //suggesting it would be actively harmful advice in an error message
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true })
    await expect(secure.set("t", "v")).rejects.toThrow(/NOT a substitute/)
  })
})
