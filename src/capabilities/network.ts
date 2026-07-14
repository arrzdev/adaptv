//Connectivity accessor — one signal across platforms:
//  • native  → @capacitor/network (accurate, event-driven)
//  • web/PWA → navigator.onLine + online/offline events (coarse: only guarantees a
//              network interface, not real reachability)
//
//Exposed as a plain subscribe/get pair (not just a hook) so it can also feed a data
//layer — e.g. TanStack Query's `onlineManager` — so query pause/resume is accurate
//on every target. `useNetworkStatus` is a thin `useSyncExternalStore` over this.
import type { PluginListenerHandle } from "@capacitor/core"
import { Network } from "@capacitor/network"
import { isNativePlatform } from "#nativ/utils/platform"

const listeners = new Set<() => void>()
let nativeConnected = true
let nativeHandle: PluginListenerHandle | null = null
let webBound = false
let nativeBound = false

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
  if (nativeBound) return
  nativeBound = true
  void Network.getStatus().then((status) => {
    nativeConnected = status.connected
    emit()
  })
  void Network.addListener("networkStatusChange", (status) => {
    nativeConnected = status.connected
    emit()
  }).then((handle) => {
    nativeHandle = handle
  })
}

/** Current online state — native cache when on device, else `navigator.onLine`. */
export function getOnline(): boolean {
  if (isNativePlatform()) return nativeConnected
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
  if (isNativePlatform()) bindNative()
  else bindWeb()
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0 && nativeHandle) {
      void nativeHandle.remove()
      nativeHandle = null
      nativeBound = false
    }
  }
}
