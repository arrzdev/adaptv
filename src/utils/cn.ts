import type { ClassValue } from "clsx"
import { clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

const customTwMerge = extendTailwindMerge<
  "pwa-touch-behavior" | "pwa-scroll-behavior"
>({
  extend: {
    classGroups: {
      "pwa-touch-behavior": ["clickable", "non-clickable"],
      "pwa-scroll-behavior": [
        "scrollable-x",
        "scrollable-y",
        "scrollable",
      ],
      //register the tailwindcss-safe-area padding utilities into the standard
      //padding groups so `pb-safe` conflict-resolves against `pb-0` etc. (a
      //`View safe="bottom"` must win over a stray consumer padding class).
      p: [{ p: ["safe"] }],
      px: [{ px: ["safe"] }],
      py: [{ py: ["safe"] }],
      pt: [{ pt: ["safe"] }],
      pr: [{ pr: ["safe"] }],
      pb: [{ pb: ["safe"] }],
      pl: [{ pl: ["safe"] }],
    },
    /*
     * A custom utility must declare conflicts with everything it EXPANDS to, or
     * the `locked` layer silently stops being a guarantee.
     *
     * `scrollable-y` is one class but sets four properties (`overflow-y`,
     * `overflow-x`, `touch-action`, `overscroll-behavior-y`). tailwind-merge only
     * drops a class it knows conflicts — and a custom group it has never heard of
     * conflicts with nothing. So `cn("scrollable-y", "overflow-hidden")` kept
     * BOTH, and which one actually applied was decided by the order the rules
     * happened to land in the compiled stylesheet rather than by the caller.
     *
     * That is exactly the failure `mergeStyles`' precedence exists to prevent:
     * a consumer's `overflow-hidden` could defeat a `ScrollView`'s scroll axis,
     * which is owned by a PROP (L6). Same for `clickable`, whose whole purpose is
     * the `touch-action` longhand that works around WebKit 240917.
     */
    conflictingClassGroups: {
      "pwa-scroll-behavior": [
        "overflow",
        "overflow-x",
        "overflow-y",
        "touch",
        "overscroll",
        "overscroll-x",
        "overscroll-y",
      ],
      "pwa-touch-behavior": ["touch"],
      overflow: ["pwa-scroll-behavior"],
      "overflow-x": ["pwa-scroll-behavior"],
      "overflow-y": ["pwa-scroll-behavior"],
      touch: ["pwa-scroll-behavior", "pwa-touch-behavior"],
      overscroll: ["pwa-scroll-behavior"],
      "overscroll-x": ["pwa-scroll-behavior"],
      "overscroll-y": ["pwa-scroll-behavior"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return customTwMerge(clsx(inputs))
}
