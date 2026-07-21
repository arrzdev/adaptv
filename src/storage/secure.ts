/**
 * `storage.secure` — secrets. Async, strings only, no reactive hook.
 * → `ARCHITECTURE.md §2.3`
 *
 * ## The hard platform truth, stated loudly
 *
 * **On web this is NOT secure.** There is no browser API that hides a value from
 * JavaScript running on the same origin — no Keychain equivalent, no sealed
 * store. Any XSS reads it. The web tier is a *best-effort* place to keep a token
 * out of casual reach, and calling it "secure" would be a lie that shapes how
 * people use it. Native genuinely is: Keychain on iOS, AndroidKeyStore with
 * AES/GCM on Android.
 *
 * ## Why this tier exists at all
 *
 * nativ's auth model is a **client-held bearer token**, and that is not a
 * workaround — cookie-based auth is architecturally unsupported in a native
 * WebView. WebKit closed the hybrid-app cookie bug as *deliberate*
 * ([213510](https://bugs.webkit.org/show_bug.cgi?id=213510)), third-party cookies
 * stay blocked regardless of ITP, and `requestStorageAccess()` is non-functional
 * in WKWebView. Ionic closed the equivalent issues `not_planned`. So the token
 * has to live somewhere on the client, and that somewhere should be the best
 * store each platform actually has.
 *
 * ⚠︎ **`@capacitor/preferences` must never back this.** It is plaintext —
 * `UserDefaults` on iOS, `SharedPreferences(MODE_PRIVATE)` on Android, verified
 * in source, with no warning in its README. That is why `storage.kv` and
 * `storage.secure` have different backends rather than one shared one.
 * → `DECISIONS.md` B23
 *
 * The native backend is `@aparajita/capacitor-secure-storage` (MIT), imported
 * **lazily** so a web-only app never needs it installed.
 */
import { isNativePlatform } from "#nativ/utils/platform"

const SECURE_PREFIX = "nativ:secure:"

type SecureStoragePlugin = {
  get(options: { key: string }): Promise<{ value: string | null }>
  set(options: { key: string; value: string }): Promise<void>
  remove(options: { key: string }): Promise<void>
}

/**
 * Held in a variable, not written inline, so TypeScript cannot resolve it
 * statically. That is deliberate: this is an **optional** native peer, and a
 * literal specifier would make `tsc` fail for every web-only consumer who has no
 * reason to install a Keychain plugin.
 */
const SECURE_STORAGE_MODULE = "@aparajita/capacitor-secure-storage"

let pluginPromise: Promise<SecureStoragePlugin | null> | null = null

/**
 * Load the native plugin lazily and at most once.
 *
 * Resolves to `null` when it isn't installed, rather than throwing: a web-only
 * app must not be forced to add a native-only dependency, and the failure has to
 * surface as a clear message at the call site rather than as a module-resolution
 * error at import time.
 */
function loadPlugin(): Promise<SecureStoragePlugin | null> {
  pluginPromise ??= import(/* @vite-ignore */ SECURE_STORAGE_MODULE)
    .then(
      (mod) =>
        (mod as { SecureStorage?: SecureStoragePlugin }).SecureStorage ??
        null,
    )
    .catch(() => null)
  return pluginPromise
}

function missingPlugin(): Error {
  return new Error(
    "[nativ] storage.secure needs `@aparajita/capacitor-secure-storage` on a native build. " +
      "Install it and run `nativ sync`. (@capacitor/preferences is NOT a substitute — it stores plaintext.)",
  )
}

export const secure = {
  /** Read a secret. Resolves to `undefined` when absent. */
  async get(key: string): Promise<string | undefined> {
    if (isNativePlatform()) {
      const plugin = await loadPlugin()
      if (!plugin) throw missingPlugin()
      const { value } = await plugin.get({ key: SECURE_PREFIX + key })
      return value ?? undefined
    }
    try {
      return localStorage.getItem(SECURE_PREFIX + key) ?? undefined
    } catch {
      return undefined
    }
  },

  async set(key: string, value: string): Promise<void> {
    if (isNativePlatform()) {
      const plugin = await loadPlugin()
      if (!plugin) throw missingPlugin()
      await plugin.set({ key: SECURE_PREFIX + key, value })
      return
    }
    //Deliberately NOT swallowed on web: a token that silently failed to persist
    //logs the user out on next load with no explanation. Storage tiers that hold
    //secrets should fail loudly.
    localStorage.setItem(SECURE_PREFIX + key, value)
  },

  async remove(key: string): Promise<void> {
    if (isNativePlatform()) {
      const plugin = await loadPlugin()
      if (!plugin) throw missingPlugin()
      await plugin.remove({ key: SECURE_PREFIX + key })
      return
    }
    try {
      localStorage.removeItem(SECURE_PREFIX + key)
    } catch {
      //nothing to remove if we could never write it
    }
  },

  /**
   * Whether this platform can actually keep a secret.
   *
   * `false` on web, always. Use it to decide policy — a shorter token lifetime,
   * or requiring re-auth for a sensitive action — not to decide whether to call
   * `set`. Do not present a web value to the user as securely stored.
   */
  isHardwareBacked(): boolean {
    return isNativePlatform()
  },
}
