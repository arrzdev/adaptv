import { useMediaQuery } from "#adaptv/hooks/use-media-query"

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

/**
 * Reactive `prefers-reduced-motion`. `false` on the server and during
 * hydration; the live preference from the first client render on, tracked for
 * the lifetime of the component.
 *
 * One shared list for every button, image and row on the screen — see
 * {@link useMediaQuery}. It used to be an effect that set state, which handed a
 * component mounting with the preference on a second render to correct itself.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY)
}
