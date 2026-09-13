import {
  BackPriority,
  registerBackHandler,
} from "@arrzdev/adaptv/capabilities"
import { adaptvBack } from "@arrzdev/adaptv/hooks"
import { useRouter } from "@arrzdev/adaptv/router"
import { useCallback } from "react"

/**
 * The installed app's left-edge swipe as a BACK press, for `EdgeSwipeGestures`'
 * `left`, on a screen with a fixed place to fall back to.
 *
 * It used to be `left={() => router.navigate({ to })}`, which never asks the back
 * chain: with a drawer open, the page left with the drawer still on it. Measured in
 * the installed playground on an iOS 18.0 simulator, 2 of 2, where Android's back
 * button closes the drawer first. Through `adaptvBack()` an open overlay or menu
 * takes the swipe, and only an empty chain moves the route.
 *
 * The fallback is registered for the length of the one swipe, just above the
 * router-back floor. It defers while there is history, so the floor pops it the
 * way the header chevron does. With none (a cold launch onto this route) it
 * navigates to `fallbackTo`, so a swipe never reaches the floor's native
 * `exitApp()`. The Android back button and every other `adaptvBack()` caller
 * never see it.
 */
export function useSwipeBack(fallbackTo: string): () => void {
  const router = useRouter()
  return useCallback(() => {
    const unregister = registerBackHandler(() => {
      if (router.history.canGoBack()) return false
      void router.navigate({ to: fallbackTo })
      return true
    }, BackPriority.RouterBack + 1)
    try {
      adaptvBack()
    } finally {
      unregister()
    }
  }, [router, fallbackTo])
}
