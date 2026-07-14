import type { ClassValue } from "clsx"
import { cn } from "#nativ/utils/cn"

export type StyleLayers = {
  /** Base / default look — the primitive's neutral styling. Overridable. */
  base?: ClassValue
  /** Consumer-provided classes — override `base`, never `locked`. */
  className?: ClassValue
  /**
   * Structural / cross-platform-correctness classes — win over BOTH `base` and the
   * consumer `className`. Applied last so tailwind-merge resolves conflicts in their
   * favour. (For behaviour the consumer must not touch AT ALL — e.g. scroll — prefer
   * a prop → data-attribute → CSS so there's no class to fight; `locked` covers the
   * soft-structural look. See VISION.md.)
   */
  locked?: ClassValue
}

/**
 * Compose a primitive's classes with correct precedence:
 *
 * ```
 * base  <  className  <  locked
 * ```
 *
 * The consumer can restyle the neutral defaults, but can't break the structural
 * classes the primitive owns. Precedence rides on tailwind-merge's last-wins
 * conflict resolution (including nativ's custom `scrollable-*` / `clickable` groups).
 */
export function mergeStyles({
  base,
  className,
  locked,
}: StyleLayers): string {
  return cn(base, className, locked)
}
