//Connectivity accessor — one signal across platforms:
//  • native  → @capacitor/network (accurate, event-driven), when the binary carries it
//  • web/PWA → navigator.onLine + online/offline events (coarse: only guarantees a
//              network interface, not real reachability). Also a native binary
//              without the plugin, whose bridge rejects. On iOS WKWebView's own
//              signal still moves there. On Android it only does with the
//              ACCESS_NETWORK_STATE permission, which the plugin's manifest is
//              what declares, so that binary reads online either way.
//
//Exposed as a plain subscribe/get pair (not just a hook) so it can also feed a data
//layer — e.g. TanStack Query's `onlineManager` — so query pause/resume is accurate
//on every target. `useIsOffline` is a thin `useSyncExternalStore` over this.
//
//The accessor stays phrased positively (`getOnline`) while the hook is phrased
//negatively (`useIsOffline`) on purpose: this layer reports the raw signal, and the
//hook names the only direction that signal is trustworthy in (`false` means offline;
//`true` only means an interface exists, not that anything is reachable).
import type { PluginListenerHandle } from "@capacitor/core"
import { Network } from "@capacitor/network"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isNativePlatform } from "#adaptv/utils/platform"

const listeners = new Set<() => void>()
let nativeConnected = true
let webBound = false

/**
 * The live native binding, or `null` when none is held. `disposed` is per binding
 * because the bridge answers asynchronously: the last subscriber can leave before
 * `addListener` resolves (useSyncExternalStore under StrictMode always does in
 * dev), and the handle that arrives afterwards must remove itself rather than
 * keep a listener nobody will ever release.
 */
type NativeBinding = {
  disposed: boolean
  handle: PluginListenerHandle | null
}
let nativeBinding: NativeBinding | null = null

//A bridge call that rejects anyway (an OS error, or a runtime that injected no
//plugin list to ask) is fire-and-forget here, so nothing would handle it: it
//would reach the window's `unhandledrejection` event, and with it the console and
//any error reporter the app installed. The default state (`nativeConnected =
//true`) is the degraded answer. Passed as `.then`'s second argument, not
//`.catch`, so an exception thrown by a subscriber still surfaces.
const ignoreBridgeRejection = () => {}

/**
 * Whether connectivity comes from the plugin. Asked of the **binary**, not the
 * bundle: an OTA bundle can land on a binary built before the plugin. There
 * `getStatus` rejects, so the native cache would read online for the whole launch,
 * while the WebView's own `navigator.onLine` is live on iOS (see the header for
 * why Android's is not).
 */
function viaPlugin(): boolean {
  return isNativePlatform() && hasNativePlugin("Network")
}

function emit(): void {
  for (const cb of listeners) cb()
}

function bindWeb(): void {
  if (webBound || typeof window === "undefined") return
  webBound = true
  window.addEventListener("online", emit)
  window.addEventListener("offline", emit)
}

function bindNative(): void {
  if (nativeBinding) return
  const binding: NativeBinding = { disposed: false, handle: null }
  nativeBinding = binding
  void Network.getStatus().then((status) => {
    if (binding.disposed) return
    nativeConnected = status.connected
    emit()
  }, ignoreBridgeRejection)
  void Network.addListener("networkStatusChange", (status) => {
    nativeConnected = status.connected
    emit()
  }).then((handle) => {
    if (binding.disposed) void handle.remove().catch(ignoreBridgeRejection)
    else binding.handle = handle
  }, ignoreBridgeRejection)
}

function unbindNative(): void {
  if (!nativeBinding) return
  nativeBinding.disposed = true
  void nativeBinding.handle?.remove().catch(ignoreBridgeRejection)
  nativeBinding = null
}

/** Current online state — the plugin's cache when the binary has it, else `navigator.onLine`. */
export function getOnline(): boolean {
  if (viaPlugin()) return nativeConnected
  if (typeof navigator === "undefined") return true
  return navigator.onLine
}

/**
 * Subscribe to connectivity changes; returns an unsubscribe. SSR-safe (no-op on the
 * server). The underlying platform listeners are process singletons — cheap to keep,
 * so we only track React subscribers here.
 */
export function subscribeOnline(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  listeners.add(cb)
  if (viaPlugin()) bindNative()
  else bindWeb()
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) unbindNative()
  }
}
