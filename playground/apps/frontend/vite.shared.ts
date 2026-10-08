import type { UserConfig } from "vite"
import { PORTS } from "./ports"

/*
 * What the two builds of this app share: `vite.config.ts` (with Tailwind) and
 * `vite.plain.config.ts` (without). Kept in its own file so the plain config never
 * imports the Tailwind one, and with it `@tailwindcss/vite`.
 *
 * `ports.ts` is committed, and every worktree carries the SAME value — so a second
 * checkout cannot boot a dev server while the first is up. `VITE_APP_PORT` exists
 * for that case (headless e2e in a sibling worktree); a normal `dev` run passes
 * nothing and keeps the committed port.
 *
 * This used to have to move in lockstep with `supervisorPort`, because overriding
 * only the app port still died on `EADDRINUSE` from a second plugin's inspector.
 * That plugin is gone from this config — adaptv wires the server build now — so the
 * frontend holds one port again. `supervisorPort` stays reserved so `runDev` frees
 * the whole block.
 */
const appPort = Number(process.env.VITE_APP_PORT ?? PORTS.appPort)

export const shared = {
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
    noExternal: ["adaptv", "@repo/shared"],
  },
} satisfies UserConfig
