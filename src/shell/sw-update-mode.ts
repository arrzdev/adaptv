import type { ServiceWorkerUpdateMode } from "#nativ/config/types"

/**
 * Normalise the `register` config to an update mode, or `null` for "don't
 * register at all".
 *
 * `true` maps to `"prompt"` rather than `"autoUpdate"`. That is the whole point
 * of B3: the old behaviour applied `skipWaiting()` + reload the instant a new
 * worker installed, which drops unsaved state and prunes the precache under open
 * tabs — the direct cause of the stale-chunk 404 it appears to protect against.
 */
export function resolveUpdateMode(
  register: ServiceWorkerUpdateMode | boolean | undefined,
): ServiceWorkerUpdateMode | null {
  if (register === false) return null
  if (register === true || register === undefined) return "prompt"
  return register
}

/**
 * Whether an installed-and-waiting worker may be applied right now.
 *
 * Only `autoUpdate` ever auto-applies, and only while the tab is **hidden**.
 * Applying with the tab visible means reloading out from under someone who may
 * be mid-form — the failure is silent and looks like the app losing their work
 * for no reason.
 */
export function shouldApplyUpdateNow(
  mode: ServiceWorkerUpdateMode,
  visibility: DocumentVisibilityState,
): boolean {
  return mode === "autoUpdate" && visibility === "hidden"
}
