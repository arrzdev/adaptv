import { adaptv } from "@arrzdev/adaptv/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import { PORTS } from "./ports"

/*
 * `ports.ts` is committed, and every worktree carries the SAME value — so a second
 * checkout cannot boot a dev server while the first is up. `VITE_APP_PORT` exists
 * for that case (headless e2e in a sibling worktree); a normal `dev` run passes
 * nothing and keeps the committed port.
 *
 * This used to have to move in lockstep with `supervisorPort`, because overriding
 * only the app port still died on `EADDRINUSE` from a second plugin's inspector.
 * That plugin is gone from this config — adaptv wires the server build now — so the
 * frontend holds one port again. `supervisorPort` stays reserved so `runDev` frees
 * the whole block and the e2e harness has a second port to move.
 */
const appPort = Number(process.env.VITE_APP_PORT ?? PORTS.appPort)

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: appPort,
  },
  preview: {
    host: "0.0.0.0",
    port: appPort,
  },
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  ssr: {
    noExternal: ["@arrzdev/adaptv", "@repo/shared"],
  },
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
