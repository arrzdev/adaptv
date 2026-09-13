import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { secure } from "#adaptv/storage/secure"

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
    expect(localStorage.getItem("adaptv:secure:token")).toBe("abc")
    expect(localStorage.getItem("adaptv:kv:token")).toBeNull()
  })

  it("degrades get and remove quietly when localStorage itself throws", async () => {
    //Safari private mode throws on ACCESS; a read that threw would turn "no
    //token" into a crash on the first authenticated screen
    vi.stubGlobal("Capacitor", undefined)
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new DOMException("denied", "SecurityError")
      },
      removeItem() {
        throw new DOMException("denied", "SecurityError")
      },
    })
    await expect(secure.get("token")).resolves.toBeUndefined()
    await expect(secure.remove("token")).resolves.toBeUndefined()
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

/**
 * Native `secure` with the backend installed. The real plugin only exists in a
 * WebView, so the seam is the virtual module the build generates for it.
 */
async function nativeSecure(plugin: Record<string, unknown>) {
  vi.resetModules()
  vi.doMock("virtual:adaptv/secure-storage", () => ({
    SecureStorage: plugin,
  }))
  vi.stubGlobal("Capacitor", { isNativePlatform: () => true })
  return (await import("#adaptv/storage/secure")).secure
}

describe("secure — native, with the backend installed", () => {
  afterEach(() => {
    vi.doUnmock("virtual:adaptv/secure-storage")
    vi.resetModules()
  })

  it("round-trips through the plugin under the namespaced key", async () => {
    const held = new Map<string, string>()
    const fresh = await nativeSecure({
      set: async ({ key, value }: { key: string; value: string }) => {
        held.set(key, value)
      },
      get: async ({ key }: { key: string }) => ({
        value: held.get(key) ?? null,
      }),
      remove: async ({ key }: { key: string }) => {
        held.delete(key)
      },
    })
    await fresh.set("token", "abc")
    expect([...held]).toEqual([["adaptv:secure:token", "abc"]])
    expect(await fresh.get("token")).toBe("abc")
    await fresh.remove("token")
    //the plugin answers null for an absent key; the tier's contract is undefined
    expect(await fresh.get("token")).toBeUndefined()
    //and nothing ever touched the plaintext store on the way
    expect(localStorage.length).toBe(0)
  })

  it("rejects when the Keychain refuses a write, rather than reporting success", async () => {
    //the native twin of the web QuotaExceededError case: a token that silently
    //failed to persist logs the user out on the next launch with no explanation
    const fresh = await nativeSecure({
      set: () => Promise.reject(new Error("errSecInteractionNotAllowed")),
    })
    await expect(fresh.set("token", "abc")).rejects.toThrow(
      "errSecInteractionNotAllowed",
    )
    expect(localStorage.length).toBe(0)
  })
})
