import type { HatchedPatchName } from "#adaptv/utils/patch-registry"
import { hatchAttribute } from "#adaptv/utils/patch-registry"

/**
 * Whether `target` sits inside an element that opted out of `name` with
 * `data-adaptv-no-<name>` — itself or any ancestor, so marking a container opts
 * out its whole subtree.
 *
 * The one runtime reader of the local tier (`utils/patch-registry.ts`). Only
 * patches with a `"marker"` hatch are accepted: a `hatch: false` patch is a type
 * error here, not a lookup that happens to find nothing.
 *
 * This is the developer's opt-out, not the patch's own applicability: an
 * `<input>` keeping the magnifier loupe is the patch not applying by definition,
 * and stays in the patch (patch-delivery.md §6.1).
 */
export function isPatchDisabled(
  target: EventTarget | null,
  name: HatchedPatchName,
): boolean {
  if (!(target instanceof Element)) return false
  return target.closest(`[${hatchAttribute(name)}]`) !== null
}
