import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

//A fresh module per test so the in-memory map and the native `attached`-style singletons start
//clean; localStorage is cleared alongside it. Preferences is mocked so the native branch can be
//exercised without a real bridge.
const prefsStore = new Map<string, string>()
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({
      value: prefsStore.get(key) ?? null,
    })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      prefsStore.set(key, value)
    }),
  },
}))

function forceNative(native: boolean): void {
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
}

async function load() {
  vi.resetModules()
  return import("#adaptv/capabilities/keyboard-height-cache")
}

function inputEl(
  attrs: { type?: string; inputmode?: string; autocomplete?: string } = {},
): HTMLInputElement {
  const el = document.createElement("input")
  if (attrs.type) el.type = attrs.type
  if (attrs.inputmode) el.setAttribute("inputmode", attrs.inputmode)
  if (attrs.autocomplete) {
    el.setAttribute("autocomplete", attrs.autocomplete)
  }
  return el
}

beforeEach(() => {
  prefsStore.clear()
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("keyboardCacheKey", () => {
  it("keys full-keyboard fields as text, at the given width", async () => {
    const { keyboardCacheKey } = await load()
    expect(keyboardCacheKey(inputEl({ type: "text" }), 390)).toBe(
      "390:text:-",
    )
    expect(keyboardCacheKey(inputEl({ type: "email" }), 390)).toBe(
      "390:text:-",
    )
    const textarea = document.createElement("textarea")
    expect(keyboardCacheKey(textarea, 390)).toBe("390:text:-")
  })

  it("keys the digit pad separately from the full keyboard", async () => {
    const { keyboardCacheKey } = await load()
    expect(keyboardCacheKey(inputEl({ type: "tel" }), 390)).toBe(
      "390:numeric:-",
    )
    expect(keyboardCacheKey(inputEl({ type: "number" }), 390)).toBe(
      "390:numeric:-",
    )
    expect(keyboardCacheKey(inputEl({ inputmode: "decimal" }), 390)).toBe(
      "390:numeric:-",
    )
  })

  it("lets inputmode override the type", async () => {
    const { keyboardCacheKey } = await load()
    //type=text would be a full keyboard, but the author asked for a numeric pad
    expect(
      keyboardCacheKey(
        inputEl({ type: "text", inputmode: "numeric" }),
        390,
      ),
    ).toBe("390:numeric:-")
  })

  //The keyboard over a login form carries iOS's ~45px AutoFill bar, so it is a different HEIGHT
  //from the same device's plain-text keyboard — sharing one entry made each predict the other's
  //height, which is the sheet landing then stepping again.
  it("keys an AutoFill (login) field apart from a plain text field", async () => {
    const { keyboardCacheKey } = await load()
    const plain = keyboardCacheKey(inputEl({ type: "text" }), 390)
    expect(keyboardCacheKey(inputEl({ type: "password" }), 390)).toBe(
      "390:text:af",
    )
    expect(
      keyboardCacheKey(
        inputEl({ type: "email", autocomplete: "email" }),
        390,
      ),
    ).toBe("390:text:af")
    expect(plain).toBe("390:text:-")
  })

  it("groups the whole login form onto ONE key — both fields raise the same keyboard", async () => {
    const { keyboardCacheKey } = await load()
    //the sign-in surface: an [autocomplete=email] field above a password field
    expect(
      keyboardCacheKey(
        inputEl({ type: "email", autocomplete: "email" }),
        390,
      ),
    ).toBe(
      keyboardCacheKey(
        inputEl({ type: "password", autocomplete: "current-password" }),
        390,
      ),
    )
  })

  it("reads `autocomplete` as a token list, not a whole string", async () => {
    const { keyboardCacheKey } = await load()
    expect(
      keyboardCacheKey(
        inputEl({
          type: "text",
          autocomplete: "section-blue billing email",
        }),
        390,
      ),
    ).toBe("390:text:af")
    //a token that is not an AutoFill-bar field stays on the plain key
    expect(
      keyboardCacheKey(
        inputEl({ type: "text", autocomplete: "organization" }),
        390,
      ),
    ).toBe("390:text:-")
  })

  it("encodes orientation via the width — a rotated device is a different key", async () => {
    const { keyboardCacheKey } = await load()
    const el = inputEl({ type: "text" })
    expect(keyboardCacheKey(el, 390)).not.toBe(keyboardCacheKey(el, 844))
  })

  it("returns null for anything that raises no keyboard", async () => {
    const { keyboardCacheKey } = await load()
    expect(keyboardCacheKey(inputEl({ type: "checkbox" }), 390)).toBeNull()
    expect(keyboardCacheKey(inputEl({ type: "range" }), 390)).toBeNull()
    expect(keyboardCacheKey(document.createElement("div"), 390)).toBeNull()
  })
})

describe("predict / record", () => {
  it("misses before anything is recorded, hits after", async () => {
    const { predictKeyboardHeight, recordKeyboardHeight } = await load()
    const el = inputEl({ type: "text" })
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    })

    expect(predictKeyboardHeight(el)).toBeNull()
    recordKeyboardHeight(el, 336)
    expect(predictKeyboardHeight(el)).toBe(336)
  })

  it("keeps the digit-pad and full-keyboard heights apart", async () => {
    const { predictKeyboardHeight, recordKeyboardHeight } = await load()
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    })
    recordKeyboardHeight(inputEl({ type: "text" }), 336)
    recordKeyboardHeight(inputEl({ type: "tel" }), 260)

    expect(predictKeyboardHeight(inputEl({ type: "text" }))).toBe(336)
    expect(predictKeyboardHeight(inputEl({ type: "tel" }))).toBe(260)
  })

  it("keeps the login keyboard's height off the plain-text entry", async () => {
    const { predictKeyboardHeight, recordKeyboardHeight } = await load()
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    })
    //device-measured on an iPhone 16 Pro: 346 with the AutoFill bar, 301 without
    recordKeyboardHeight(
      inputEl({ type: "email", autocomplete: "email" }),
      346,
    )
    recordKeyboardHeight(inputEl({ type: "text" }), 301)

    //the deck-name field must not inherit the login form's taller keyboard, or it would over-lift
    //by the bar's height on every open and settle back down
    expect(predictKeyboardHeight(inputEl({ type: "text" }))).toBe(301)
    expect(predictKeyboardHeight(inputEl({ type: "password" }))).toBe(346)
  })

  it("overwrites a stale height so a keyboard switch self-heals", async () => {
    const { predictKeyboardHeight, recordKeyboardHeight } = await load()
    const el = inputEl({ type: "text" })
    recordKeyboardHeight(el, 336)
    recordKeyboardHeight(el, 300) //user switched to a shorter third-party keyboard
    expect(predictKeyboardHeight(el)).toBe(300)
  })

  it("ignores non-positive and rounds fractional heights", async () => {
    const { predictKeyboardHeight, recordKeyboardHeight } = await load()
    const el = inputEl({ type: "text" })
    recordKeyboardHeight(el, 0)
    expect(predictKeyboardHeight(el)).toBeNull()
    recordKeyboardHeight(el, 335.7)
    expect(predictKeyboardHeight(el)).toBe(336)
  })
})

describe("durable persistence", () => {
  it("round-trips through localStorage on web", async () => {
    const first = await load()
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    })
    first.recordKeyboardHeight(inputEl({ type: "text" }), 336)
    expect(
      localStorage.getItem(first.KEYBOARD_HEIGHT_CACHE_STORAGE_KEY),
    ).toContain("336")

    //a fresh module (new launch) with a cold in-memory map re-hydrates from the store
    const next = await load()
    expect(
      next.predictKeyboardHeight(inputEl({ type: "text" })),
    ).toBeNull()
    await next.loadKeyboardHeightCache()
    expect(next.predictKeyboardHeight(inputEl({ type: "text" }))).toBe(336)
  })

  it("round-trips through Preferences on native", async () => {
    forceNative(true)
    const first = await load()
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    })
    first.recordKeyboardHeight(inputEl({ type: "text" }), 336)
    //let the fire-and-forget write settle
    await Promise.resolve()
    await Promise.resolve()

    const next = await load()
    await next.loadKeyboardHeightCache()
    expect(next.predictKeyboardHeight(inputEl({ type: "text" }))).toBe(336)
    //nothing leaked into web storage on the native path
    expect(
      localStorage.getItem(first.KEYBOARD_HEIGHT_CACHE_STORAGE_KEY),
    ).toBeNull()
  })

  it("starts empty when the store holds corrupt JSON", async () => {
    localStorage.setItem("adaptv-kb-heights", "{not valid json")
    const { loadKeyboardHeightCache, predictKeyboardHeight } = await load()
    await loadKeyboardHeightCache()
    expect(predictKeyboardHeight(inputEl({ type: "text" }))).toBeNull()
  })
})
