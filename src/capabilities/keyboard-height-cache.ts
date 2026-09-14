//The predictive half of the keyboard signal: what height the on-screen keyboard is *about* to be,
//known the instant a field is focused — before the OS has announced anything.
//
//The reactive paths (visualViewport on web, native will-show/insets) all learn the height only
//AFTER the keyboard has begun to appear, so a purely reactive lift is always one or two frames
//late. A form is the same shape every time it is opened on the same device, so the height the
//keyboard took *last* time is an excellent guess for *this* time. Cache it, look it up
//synchronously on focus, and the sheet can start moving on the same frame as the tap — the real
//measurement then confirms or corrects the guess (see use-keyboard's predictive path).
//
//Why a learned cache and not a shipped device→height table (the rejected alternative): a static
//table is wrong too often to trust — third-party keyboards, the suggestion/autofill bar, numeric
//vs full layouts, CJK IMEs, and floating/split iPad keyboards all move the height for the same
//device, and the table would need updating forever. A cache that learns from real measurements is
//correct for whatever keyboard the user actually runs, and self-heals when they switch.

import { isNativePlatform } from "#adaptv/utils/platform"

/** Durable-store key. On native this lands in Preferences (SharedPreferences / UserDefaults),
 *  which survives a WebView eviction; on web it is a localStorage key. */
export const KEYBOARD_HEIGHT_CACHE_STORAGE_KEY = "adaptv-kb-heights"

//Heights within this many px are "the same" — below the noise floor of a real re-measurement, so
//we neither rewrite storage nor treat it as a keyboard change.
const HEIGHT_EPSILON = 2

/**
 * The two keyboard layouts whose heights differ enough to cache separately.
 *
 * `numeric` is the digit pad (`inputmode="numeric|decimal|tel"`, `type="number|tel"`) — shorter
 * than the full keyboard on most platforms and with no suggestion strip. Everything else that
 * raises a keyboard (text, search, email, url, password, textarea, contenteditable) lands the
 * full QWERTY layout at effectively one height. Splitting finer would fragment the cache — two
 * entries that must each be warmed — for keyboards that are the same height anyway.
 */
type KeyboardKind = "numeric" | "text"

const NUMERIC_INPUT_MODES = new Set(["numeric", "decimal", "tel"])
const NUMERIC_INPUT_TYPES = new Set(["number", "tel"])
//`autocomplete` tokens that make iOS put its AutoFill accessory bar ("Passwords") above the
//keyboard. Device-measured on an iPhone 16 Pro: that bar is a SECOND height step of ~45px arriving
//~250ms after the keyboard itself, so a field that raises it and a field that doesn't have
//genuinely different keyboard heights — and must not share a cache entry, or each would predict
//the other's height and the sheet would settle, then step again.
const AUTOFILL_AUTOCOMPLETE_TOKENS = new Set([
  "username",
  "email",
  "current-password",
  "new-password",
  "one-time-code",
])
//Input types that raise NO keyboard — mirrors use-keyboard's willOpenVirtualKeyboard so a
//prediction is never keyed for a checkbox or slider. Kept as a local copy rather than an import
//because use-keyboard imports this module (predict/record) and a back-import would cycle.
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "image",
  "button",
  "submit",
  "reset",
])

function keyboardKind(el: HTMLElement): KeyboardKind | null {
  if (el instanceof HTMLInputElement) {
    if (NON_TEXT_INPUT_TYPES.has(el.type)) return null
    //inputmode wins when set — it is the author's explicit statement of which keyboard to raise,
    //and it overrides what `type` would otherwise imply (e.g. type=text inputmode=decimal)
    const mode = el.getAttribute("inputmode")?.toLowerCase()
    if (mode) return NUMERIC_INPUT_MODES.has(mode) ? "numeric" : "text"
    return NUMERIC_INPUT_TYPES.has(el.type) ? "numeric" : "text"
  }
  if (el instanceof HTMLTextAreaElement) return "text"
  if (el.isContentEditable) {
    const mode = el.getAttribute("inputmode")?.toLowerCase()
    return mode && NUMERIC_INPUT_MODES.has(mode) ? "numeric" : "text"
  }
  return null
}

/**
 * Whether `el` raises the OS AutoFill accessory bar above the keyboard — the "Passwords" strip iOS
 * puts over a login form.
 *
 * Read from the field's OWN declared intent (its `type` and `autocomplete`) and deliberately NOT
 * from the surrounding DOM. Walking up for a nearby password field would track WebKit's own
 * heuristic more closely, but its answer changes with whatever else happens to be mounted at that
 * moment — the same field would key two different ways across two opens and the cache would thrash.
 * Declared intent is stable for a given field, which is what a cache key needs.
 *
 * A wrong guess is not fatal: this only selects which entry a PREDICTION comes from, and the real
 * measurement that follows corrects the height through the normal grow/shrink path and re-records
 * the truth under this key.
 */
export function raisesAutofillAccessoryBar(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && el.type === "password") return true
  const autocomplete = el.getAttribute("autocomplete")?.toLowerCase()
  if (!autocomplete) return false
  //a space-separated token list ("section-billing shipping email"), so match any token
  return autocomplete
    .split(/\s+/)
    .some((token) => AUTOFILL_AUTOCOMPLETE_TOKENS.has(token))
}

/**
 * Cache key for the keyboard `el` will raise, or `null` if `el` raises none.
 *
 * Keyed on `{ viewportWidth, kind, autofill }` and deliberately NOT on device model. The layout
 * width already identifies the device implicitly and moves when it rotates — so it encodes
 * orientation for free, and a landscape keyboard (whose height is the interesting, sheet-exceeding
 * case) gets its own entry without a separate orientation term. `kind` keeps the digit pad from
 * being confused with the full keyboard, and `autofill` keeps a login field (whose keyboard carries
 * the ~45px AutoFill bar) from being confused with a plain text field on the same device.
 *
 * Changing the shape retires previously stored entries — they simply stop matching, so the affected
 * field shapes fall back to the reactive path once and re-learn. No migration needed.
 */
export function keyboardCacheKey(
  el: HTMLElement,
  viewportWidth: number = typeof window === "undefined"
    ? 0
    : window.innerWidth,
): string | null {
  const kind = keyboardKind(el)
  if (!kind) return null
  const autofill = raisesAutofillAccessoryBar(el) ? "af" : "-"
  return `${Math.round(viewportWidth)}:${kind}:${autofill}`
}

//---- in-memory hot path ----------------
//
//The lookup on focus has to be synchronous — it feeds a lift that must start on the same frame as
//the tap — so the durable store is mirrored into this map at boot (loadKeyboardHeightCache) and
//every write updates the map first, then persists in the background.

const cache = new Map<string, number>()

/** The learned keyboard height for the field `el` will focus, or `null` on a cache miss. */
export function predictKeyboardHeight(el: HTMLElement): number | null {
  const key = keyboardCacheKey(el)
  if (!key) return null
  return cache.get(key) ?? null
}

/**
 * Record a keyboard height a caller has committed to. Not every one of those went through the
 * web observer's stability window — a first raise and an upward correction commit (and record)
 * immediately, because the lift has to start now; only a DROP waits for the window. What the
 * cache therefore trends toward is the height this device actually settles at — and a keyboard-app or language
 * switch is absorbed the next time that field is measured. A no-op for a non-field or an
 * unchanged height, so it is cheap to call on every measurement.
 */
export function recordKeyboardHeight(
  el: HTMLElement,
  height: number,
): void {
  if (!(height > 0)) return
  const key = keyboardCacheKey(el)
  if (!key) return
  const rounded = Math.round(height)
  const prev = cache.get(key)
  if (prev !== undefined && Math.abs(prev - rounded) < HEIGHT_EPSILON) {
    return
  }
  cache.set(key, rounded)
  void persist()
}

//---- durable store ----------------
//
//Native → Preferences (durable across WebView eviction, the whole point of persisting); web/PWA →
//localStorage. Both are wrapped in try/catch: a store that is unavailable or full degrades to an
//in-memory-only cache (predictions still work within the session, just not across launches).

async function readStore(): Promise<string | null> {
  if (isNativePlatform()) {
    try {
      const { Preferences } = await import("@capacitor/preferences")
      const { value } = await Preferences.get({
        key: KEYBOARD_HEIGHT_CACHE_STORAGE_KEY,
      })
      return value
    } catch {
      return null
    }
  }
  try {
    return globalThis.localStorage?.getItem(
      KEYBOARD_HEIGHT_CACHE_STORAGE_KEY,
    )
  } catch {
    return null
  }
}

async function writeStore(serialized: string): Promise<void> {
  if (isNativePlatform()) {
    try {
      const { Preferences } = await import("@capacitor/preferences")
      await Preferences.set({
        key: KEYBOARD_HEIGHT_CACHE_STORAGE_KEY,
        value: serialized,
      })
    } catch {
      //storage unavailable — session-only cache
    }
    return
  }
  try {
    globalThis.localStorage?.setItem(
      KEYBOARD_HEIGHT_CACHE_STORAGE_KEY,
      serialized,
    )
  } catch {
    //quota / disabled storage — session-only cache
  }
}

async function persist(): Promise<void> {
  await writeStore(JSON.stringify(Object.fromEntries(cache)))
}

/**
 * Load the durable cache into memory. Call once at startup, before any drawer can open, so the
 * first focus already has its prediction. Silently starts empty if the store is unavailable or
 * corrupt — a cold cache just falls back to the reactive path.
 */
export async function loadKeyboardHeightCache(): Promise<void> {
  const raw = await readStore()
  if (!raw) return
  //The native read is an import plus a bridge round trip, so a keyboard can be measured before it
  //lands. A key the map already holds when the read lands is newer than the store and is kept, and
  //the record that put it there wrote the store without the stored entries, so the merged map is
  //written back. A boot that finds the map empty writes nothing.
  const heldBeforeMerge = cache.size > 0
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && value > 0 && !cache.has(key)) {
        cache.set(key, Math.round(value))
      }
    }
  } catch {
    //corrupt entry — ignore and let the cache re-learn from live measurements
  }
  if (heldBeforeMerge) void persist()
}

/** Clear the in-memory cache. Testing seam only — the durable store is left untouched. */
export function __resetKeyboardHeightCacheForTests(): void {
  cache.clear()
}
