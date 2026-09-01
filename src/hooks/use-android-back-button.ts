import { App } from "@capacitor/app"
import type { PluginListenerHandle } from "@capacitor/core"
import { useRouter } from "@tanstack/react-router"
import { useEffect } from "react"
import {
  BackPriority,
  registerBackHandler,
  runBackChain,
} from "#adaptv/capabilities/back-chain"
import { getOS, isNativePlatform } from "#adaptv/utils/platform"

/**
 * Install the single platform back listener and the chain's **floor handler**.
 * Mount once at the root, inside the router context.
 *
 * This used to *be* the whole back story — it hardcoded
 * `canGoBack() ? back() : exitApp()` with no interception point, so an open
 * drawer had no way to claim the press and back navigated out from under it.
 * That behaviour is now the lowest-priority entry in a shared chain: overlays
 * register above it and consume the press first. → `docs/design/coordination.md §2`
 *
 * Android-native only for the *hardware* button (iOS and web have none), but the
 * chain itself is cross-platform and drives {@link adaptvBack} everywhere.
 */
export function useAndroidBackButton(): void {
  const router = useRouter()

  //The floor handler is registered on EVERY platform, not just Android: it is what
  //`adaptvBack()` falls through to for an in-app back affordance, and an installed
  //PWA has no browser chrome to provide one.
  useEffect(
    () =>
      registerBackHandler(() => {
        if (router.history.canGoBack()) {
          router.history.back()
          return true
        }
        //nothing left to go back to. Exiting is only meaningful on native — a web
        //tab must NOT be closed out from under the user, so defer instead and let
        //the browser do whatever it normally would.
        if (!isNativePlatform()) return false
        void App.exitApp()
        return true
      }, BackPriority.RouterBack),
    [router],
  )

  useEffect(() => {
    if (!isNativePlatform() || getOS() !== "android") return
    let handle: PluginListenerHandle | undefined
    void App.addListener("backButton", () => {
      runBackChain()
    }).then((h) => {
      handle = h
    })
    return () => {
      void handle?.remove()
    }
  }, [])
}

/**
 * Programmatic back — the same path the Android hardware button takes.
 *
 * Unifies three things that would otherwise diverge: the hardware button, an
 * in-app back affordance, and (when installed) the OS edge gesture that memory
 * history renders inert. Returns `true` if something handled it.
 */
export function adaptvBack(): boolean {
  return runBackChain()
}
