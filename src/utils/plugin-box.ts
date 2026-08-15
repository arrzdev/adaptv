/**
 * A native plugin, held where the Promise machinery cannot reach it.
 *
 * ## 🔴 The bug this exists to make impossible
 *
 * A Capacitor plugin object is a `Proxy` whose `get` trap answers **any**
 * property with a callable — that is how `plugin.someNativeMethod()` works with
 * no generated stub for it. It answers `then` too.
 *
 * That makes every plugin a **thenable**, and the Promise resolution procedure
 * does not treat a thenable as a value: it *adopts* it, by calling
 * `value.then(resolve, reject)`. On a plugin proxy that call becomes a bridge
 * message to a native method named `then`, which no plugin implements. Nothing
 * ever calls back, so the promise neither resolves nor rejects. Ever.
 *
 * So this line, which looks like the most ordinary lazy-load in the world:
 *
 * ```ts
 * import("@some/plugin").then((mod) => mod.SomePlugin) //hangs on device
 * ```
 *
 * ...hangs. Not fails — **hangs**, with no error, no rejection, and nothing in
 * any `catch`, because there is nothing to catch. It is also invisible in a
 * browser, where `window.Capacitor` is absent and the plugin is a plain object.
 *
 * Measured on an iOS simulator before the fix: the dynamic import resolved, the
 * chunk evaluated, the `.then` callback ran and returned the plugin — and the
 * `await` on the other side never came back. The app looked like it was ignoring
 * its update channel; the channel looked like it was never contacted. Both were
 * true, and neither was the bug.
 *
 * A box is a plain object with no `then`, so the promise resolves with the box
 * and the plugin comes out of it synchronously, untouched.
 */
export type PluginBox<T> = { readonly plugin: T | null }

/**
 * The box meaning "no plugin here".
 *
 * A real value rather than `null`, so a `.catch` has something to return that
 * keeps the promise's type — and so no call site is ever tempted to reach for the
 * plugin without opening a box first.
 */
export const NO_PLUGIN: PluginBox<never> = { plugin: null }

/**
 * Put a plugin export in a box. `undefined` becomes `null`.
 *
 * ⚠︎ Open the box at the point of use, with a destructure. Never unwrap it back
 * into a promise chain — `.then((box) => box.plugin)` returns the proxy from a
 * `then` callback again, which is exactly the shape that hangs.
 */
export function boxPlugin<T>(value: unknown): PluginBox<T> {
  return { plugin: (value as T | undefined) ?? null }
}
