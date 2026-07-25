import type { StatusBarAppearance } from "#adaptv/capabilities/status-bar"
import {
  applyStatusBar,
  enableEdgeToEdge,
} from "#adaptv/capabilities/status-bar"
import { useIsomorphicLayoutEffect } from "#adaptv/hooks/use-isomorphic-layout-effect"

/**
 * Keep the native system bars' icon style in sync with the app's resolved theme, and
 * put the app edge-to-edge (content under the bars, safe-area padding). No-op on web —
 * the browser owns the bars there. Mount once near the root with the resolved appearance.
 * The bar background comes from CSS (the rendered html/body colour under the inset), not
 * a native call — so this takes no colour.
 */
export function useStatusBar(appearance: StatusBarAppearance): void {
  useIsomorphicLayoutEffect(() => {
    enableEdgeToEdge()
  }, [])
  useIsomorphicLayoutEffect(() => {
    applyStatusBar(appearance)
  }, [appearance])
}
