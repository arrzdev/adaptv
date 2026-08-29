import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react"
import type {
  ChromeTintOptions,
  ChromeTintTransition,
} from "#adaptv/capabilities/theme-color"
import {
  getChromeTint,
  getChromeTintBase,
  restoreChromeTint,
  setChromeTint,
  subscribeChromeTintBase,
  transitionChromeTint,
} from "#adaptv/capabilities/theme-color"

export type UseChromeTint = {
  /**
   * Whether there is a `theme-color` tag to write. `false` during SSR and on the hydration pass,
   * then settled on mount — so branch a *render* on it only if a wrong first frame is acceptable.
   *
   * NOT a promise that anything will be visible: whether the tag reaches a toolbar is the
   * browser's and the platform's business (see below). Nothing needs this to call safely — every
   * method here is a no-op when there is no tag.
   */
  supported: boolean
  /**
   * The colour {@link restore} returns to: whatever the app's theme currently resolves to. A
   * VALUE, not a getter — it is state, it moves when the theme flips, and a component that shows
   * it re-renders when it does.
   */
  base: string | null
  /**
   * The tint on the tag right now — mid-transition, that is the frame's colour.
   *
   * Deliberately a function rather than reactive state. Mid-transition this changes every frame,
   * and subscribing a component tree to a 60fps animation value would re-render the app for the
   * whole length of a sheet opening. Call it when you want a sample; poll it only if you are
   * displaying an animation in flight, which is a debug readout, not app state.
   */
  read: () => string | null
  /** Move the tint to `color` along a curve. */
  transitionTo: (
    color: string,
    options?: ChromeTintOptions,
  ) => ChromeTintTransition
  /** Put the tint at `color` now — for following a finger, where progress has no clock. */
  set: (color: string) => void
  /** Give the chrome back to the app's theme. */
  restore: (
    options?: Omit<ChromeTintOptions, "from">,
  ) => ChromeTintTransition
}

/**
 * Animate the browser's chrome — the toolbar above a mobile web page — from the app's theme
 * colour to another one and back, along a `cubic-bezier` of your choosing.
 *
 * ```tsx
 * const chrome = useChromeTint()
 * // dim the toolbar with the same curve the sheet slides on
 * chrome.transitionTo("#8f8f8e", { duration: 0.38, easing: [0.32, 0.72, 0, 1] })
 * // …and hand it back
 * chrome.restore({ duration: 0.22, easing: [0.6, 0.3, 0.15, 0.5] })
 * ```
 *
 * **Treat it as a progressive enhancement, and call it unconditionally.** An installed PWA and a
 * native build have no toolbar to tint, and iOS 26+ and Firefox ignore the tag outright — in all
 * of those the calls run and change nothing anyone can see, which is exactly what they should do.
 * There is no platform check to write at the call site, and writing one would be a bet on
 * detecting a platform correctly in exchange for nothing. The full matrix is in
 * `capabilities/theme-color.ts`.
 *
 * A component that dims the chrome and then unmounts without restoring gets the tint put back
 * instantly on the way out — a dimmed toolbar with nothing on screen to explain it is never what
 * the caller meant.
 */
export function useChromeTint(): UseChromeTint {
  //`getChromeTintBase()` is set by useSyncTheme's layout effect, and is null exactly where there
  //is no tag to tint — which makes one subscription answer for both `base` and `supported`.
  //The server snapshot is null because there is no tag during SSR, which is the honest answer.
  const base = useSyncExternalStore(
    subscribeChromeTintBase,
    getChromeTintBase,
    () => null,
  )
  //whether THIS hook is the one currently holding the tint
  const holding = useRef(false)

  useEffect(() => {
    return () => {
      if (holding.current) restoreChromeTint({ duration: 0 })
    }
  }, [])

  const transitionTo = useCallback(
    (color: string, options?: ChromeTintOptions) => {
      holding.current = true
      return transitionChromeTint(color, options)
    },
    [],
  )

  const set = useCallback((color: string) => {
    holding.current = true
    setChromeTint(color)
  }, [])

  const restore = useCallback(
    (options?: Omit<ChromeTintOptions, "from">) => {
      holding.current = false
      return restoreChromeTint(options)
    },
    [],
  )

  return {
    supported: base !== null,
    base,
    read: getChromeTint,
    transitionTo,
    set,
    restore,
  }
}
