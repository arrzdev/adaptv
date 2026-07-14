import type { StatusBarAppearance } from "#nativ/capabilities/status-bar"
import {
  applyStatusBar,
  enableEdgeToEdge,
} from "#nativ/capabilities/status-bar"
import { useIsomorphicLayoutEffect } from "#nativ/hooks/use-isomorphic-layout-effect"

/**
 * Keep the native status bar in sync with the app's resolved theme, and put the app
 * edge-to-edge (content under the status bar, safe-area padding). No-op on web — the
 * browser owns the bar there. Mount once near the root with the resolved appearance.
 */
export function useStatusBar(
  appearance: StatusBarAppearance,
  backgroundColor?: string,
): void {
  useIsomorphicLayoutEffect(() => {
    enableEdgeToEdge()
  }, [])
  useIsomorphicLayoutEffect(() => {
    applyStatusBar(appearance, backgroundColor)
  }, [appearance, backgroundColor])
}
