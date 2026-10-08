import tailwindcss from "@tailwindcss/vite"
import { adaptv } from "adaptv/vite"
import { defineConfig } from "vite"
import { shared } from "./vite.shared"

//The Tailwind build. `vite.plain.config.ts` builds the same app with no Tailwind.
export default defineConfig({
  ...shared,
  plugins: [
    //NO deploy plugin. adaptv wires the server build itself, and the target is
    //auto-detected from the platform (or set with NITRO_PRESET) — so this file
    //never names a host. → docs/decisions/rendering-and-delivery.md §2
    //
    //adaptv owns route tree, entries, router, the web manifest, and
    //the service worker — all driven by adaptv.config.ts, the single source of truth
    adaptv(),
    tailwindcss(),
  ],
})
