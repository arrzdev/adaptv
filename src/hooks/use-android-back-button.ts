import { App } from "@capacitor/app"
import type { PluginListenerHandle } from "@capacitor/core"
import { useRouter } from "@tanstack/react-router"
import { useEffect } from "react"
import { getOS, isNativePlatform } from "#nativ/utils/platform"

/**
 * Wire the Android hardware back button to the router: navigate back if there's
 * history, otherwise exit the app. Android-native only — no-op on iOS and web (where
 * there's no hardware back). Mount once at the root, inside the router context.
 *
 * Pairs with {@link standaloneMemoryHistory}: installed builds use in-memory history
 * so the OS gesture is inert and the app owns navigation.
 */
export function useAndroidBackButton(): void {
  const router = useRouter()
  useEffect(() => {
    if (!isNativePlatform() || getOS() !== "android") return
    let handle: PluginListenerHandle | undefined
    void App.addListener("backButton", () => {
      if (router.history.canGoBack()) router.history.back()
      else void App.exitApp()
    }).then((h) => {
      handle = h
    })
    return () => {
      void handle?.remove()
    }
  }, [router])
}
