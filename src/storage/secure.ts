/**
 * `storage.secure` — secrets. Async, strings only, no reactive hook.
 * → `docs/design/architecture.md §2.3`
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
 * adaptv's auth model is a **client-held bearer token**, and that is not a
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
 * → `docs/decisions/register.md` B23
 *
 * The native backend is `@aparajita/capacitor-secure-storage` (MIT), imported
 * **lazily** so a web-only app never needs it installed.
 */
import { isNativePlatform } from "#adaptv/utils/platform"
import type { PluginBox } from "#adaptv/utils/plugin-box"
import { boxPlugin, NO_PLUGIN } from "#adaptv/utils/plugin-box"

const SECURE_PREFIX = "adaptv:secure:"

type SecureStoragePlugin = {
  get(options: { key: string }): Promise<{ value: string | null }>
  set(options: { key: string; value: string }): Promise<void>
  remove(options: { key: string }): Promise<void>
}

let pluginPromise: Promise<PluginBox<SecureStoragePlugin>> | null = null

/**
 * Load the native plugin lazily and at most once.
 *
 * Resolves to `null` when it isn't installed, rather than throwing: a web-only
 * app must not be forced to add a native-only dependency, and the failure has to
 * surface as a clear message at the call site rather than as a module-resolution
 * error at import time.
 *
 * 🔴 **The specifier must stay this fixed virtual id.** It used to be a `const`
 * holding the real package name, marked `@vite-ignore`, so that `tsc` would not
 * demand an optional peer. It hid the name from the compiler and, unavoidably,
 * from Rollup too — so the shipped bundle asked the WebView to resolve a bare
 * `@aparajita/capacitor-secure-storage`, which no WebView can do. This import
 * rejected on every native build, including for apps that HAD installed the
 * package, and the call sites below then told those developers to install it.
 * `src/vite/secure-storage-module.ts` now answers the same question at build
 * time, where the filesystem can actually be consulted.
 *
 * 🔴 **And the plugin must come back in a box.** The backend is a Capacitor
 * `Proxy` that answers `then` with a callable, so returning it straight from this
 * `.then` makes the promise adopt it as a thenable and hang for ever — silently,
 * and only on a device. → `#adaptv/utils/plugin-box`
 */
function loadPlugin(): Promise<PluginBox<SecureStoragePlugin>> {
  pluginPromise ??= import("virtual:adaptv/secure-storage")
    .then((mod) => boxPlugin<SecureStoragePlugin>(mod.SecureStorage))
    .catch(() => NO_PLUGIN)
  return pluginPromise
}

function missingPlugin(): Error {
  return new Error(
    "[adaptv] storage.secure needs `@aparajita/capacitor-secure-storage` on a native build. " +
      "Install it and run `adaptv sync`. (@capacitor/preferences is NOT a substitute — it stores plaintext.)",
  )
}

export const secure = {
  /** Read a secret. Resolves to `undefined` when absent. */
  async get(key: string): Promise<string | undefined> {
    if (isNativePlatform()) {
      const { plugin } = await loadPlugin()
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
      const { plugin } = await loadPlugin()
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
      const { plugin } = await loadPlugin()
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
