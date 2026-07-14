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
  },
})

export function cn(...inputs: ClassValue[]) {
  return customTwMerge(clsx(inputs))
}
