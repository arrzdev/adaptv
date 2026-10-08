import type { ClassValue } from "clsx"
import { clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/*
 * The playground's own class merge. adaptv stopped exporting `cn` when Tailwind became
 * optional (docs/decisions/styling.md §0.1): an app that wants Tailwind classes merged
 * brings `tailwind-merge` and `clsx` itself, as this one does. This is the helper adaptv
 * shipped until then, kept so the playground's call sites resolve exactly as before.
 */

/*
 * Matches every suffix adaptv's safe-area utilities accept (`adaptv/tailwind.css`):
 * the bare inset, the inset plus N spacing units, and the inset floored at N.
 * `[7]` is Tailwind's arbitrary-integer form, which the `--value(integer, [integer])`
 * in the `@utility` rules also accepts — keep the two in step.
 */
const isSafeAreaSuffix = (value: string) =>
  value === "safe" || /^safe-(offset|or)-(\d+|\[\d+\])$/.test(value)

/*
 * Fold the safe-area families into the STANDARD spacing/inset groups rather than
 * giving them groups of their own. That is the whole trick: tailwind-merge's
 * built-in conflict table already says `p` beats `px`/`pt`/…, `inset` beats
 * `top`/`bottom`/…, and so on — joining those groups inherits every one of those
 * relations for free, and `pb-safe` conflict-resolves against `pb-0` (a
 * `View safe="bottom"` must win over a stray consumer padding class) without a
 * single hand-written conflict entry.
 */
const customTwMerge = extendTailwindMerge<
  "pwa-select-behavior" | "pwa-scrollbar"
>({
  extend: {
    classGroups: {
      //`selectable` is the opt-in against the app-wide `user-select: none` reset that
      //`ui.noSelect` stamps. Without this group tailwind-merge does not know it fights
      //`select-*`, so `cn("select-none", "selectable")` emitted BOTH and compiled
      //source order decided which won — the same silent failure documented for
      //`scrollable-y` below. `Text selectable` must beat a stray consumer `select-none`.
      "pwa-select-behavior": ["selectable"],
      //one scroller shows OR hides its indicator; emitting both leaves the
      //winner to compiled source order, which is how `scrollable-y` broke once
      "pwa-scrollbar": ["scrollbar-hidden", "scrollbar-visible"],
      p: [{ p: [isSafeAreaSuffix] }],
      px: [{ px: [isSafeAreaSuffix] }],
      py: [{ py: [isSafeAreaSuffix] }],
      ps: [{ ps: [isSafeAreaSuffix] }],
      pe: [{ pe: [isSafeAreaSuffix] }],
      pt: [{ pt: [isSafeAreaSuffix] }],
      pr: [{ pr: [isSafeAreaSuffix] }],
      pb: [{ pb: [isSafeAreaSuffix] }],
      pl: [{ pl: [isSafeAreaSuffix] }],
      m: [{ m: [isSafeAreaSuffix] }],
      mx: [{ mx: [isSafeAreaSuffix] }],
      my: [{ my: [isSafeAreaSuffix] }],
      ms: [{ ms: [isSafeAreaSuffix] }],
      me: [{ me: [isSafeAreaSuffix] }],
      mt: [{ mt: [isSafeAreaSuffix] }],
      mr: [{ mr: [isSafeAreaSuffix] }],
      mb: [{ mb: [isSafeAreaSuffix] }],
      ml: [{ ml: [isSafeAreaSuffix] }],
      inset: [{ inset: [isSafeAreaSuffix] }],
      "inset-x": [{ "inset-x": [isSafeAreaSuffix] }],
      "inset-y": [{ "inset-y": [isSafeAreaSuffix] }],
      start: [{ start: [isSafeAreaSuffix] }],
      end: [{ end: [isSafeAreaSuffix] }],
      top: [{ top: [isSafeAreaSuffix] }],
      right: [{ right: [isSafeAreaSuffix] }],
      bottom: [{ bottom: [isSafeAreaSuffix] }],
      left: [{ left: [isSafeAreaSuffix] }],
    },
    /*
     * Only two custom groups are left, and both earn it: they set properties Tailwind
     * has no utility for at all (`scrollbar-width` + `::-webkit-scrollbar`, and the
     * opt-in against the app-wide `user-select` reset).
     *
     * The `clickable` / `non-clickable` / `scrollable-*` families used to live here too,
     * each with a hand-written `conflictingClassGroups` entry naming every property it
     * expanded to — because a group tailwind-merge has never heard of conflicts with
     * nothing, so `cn("scrollable-y", "overflow-hidden")` kept BOTH and compiled source
     * order picked the winner. That table was a standing liability: it had to be kept in
     * step with the CSS by hand, and the one entry nobody wrote was `cursor`, so a
     * consumer's `cursor-wait` next to `non-clickable` also emitted both and only
     * *happened* to win.
     *
     * Those families are now spelled in raw Tailwind at the call sites, so tailwind-merge
     * resolves them through the groups it already owns — `overflow`, `touch`, `cursor`,
     * `overscroll` — and there is nothing left to keep in step.
     */
    conflictingClassGroups: {
      "pwa-select-behavior": ["select"],
      select: ["pwa-select-behavior"],
      /*
       * A locked axis must beat a consumer's `overflow-hidden` BY RESOLUTION, not by
       * luck. Tailwind emits the shorthand before the longhands, so today the pair
       * `overflow-hidden overflow-y-auto` already resolves the way `ScrollView` needs —
       * but that is emission order deciding a guarantee, which is exactly the failure
       * mode the custom-utility table was full of. Declaring the relationship makes
       * tailwind-merge DROP the shorthand instead, so the winner is the caller's
       * position in `mergeStyles` and nothing else.
       */
      "overflow-x": ["overflow"],
      "overflow-y": ["overflow"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return customTwMerge(clsx(inputs))
}
