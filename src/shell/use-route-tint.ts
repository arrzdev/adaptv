import { ROUTE_TINTS } from "virtual:adaptv/route-tints"
import { useRouterState } from "@tanstack/react-router"
import { tintForRouteId } from "#adaptv/shell/route-tints"

/**
 * The `chromeTint` the route on screen declares, or `null` to follow the theme.
 *
 * Read from the **build-time table** keyed by the leaf match's route id, not from
 * the route's own options — so the colour maintained after hydration is
 * bit-for-bit the one the pre-paint script already painted. Reading the live
 * option instead would give a second source that can disagree with the first, and
 * the disagreement would show up as exactly the flash this exists to remove.
 * → `src/shell/route-tints.ts`
 *
 * It follows the **resolved** matches rather than a pending navigation, so the
 * chrome changes when the screen does and not when the link is tapped.
 *
 * Shell-internal: the consumer's surface is the route option, and a hook that
 * reads it back would be a second way to ask the same question.
 */
export function useRouteTint(): string | null {
  return useRouterState({
    select: ({ matches }) =>
      //not `.at(-1)`: Array.prototype.at is iOS 15.4, and every app runs this
      tintForRouteId(ROUTE_TINTS, matches[matches.length - 1]?.routeId),
  })
}
