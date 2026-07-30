import { adaptv } from "@arrzdev/adaptv/vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import { PORTS } from "./ports"

/*
 * `ports.ts` is the committed pair, and every worktree carries the SAME one — so a
 * second checkout cannot boot a dev server while the first is up. Both ports have to
 * move together: overriding only the app port still dies on `EADDRINUSE` from the
 * Cloudflare inspector, which is a confusing way to be told about a port you did not
 * name. The env pair exists for that case (headless e2e in a sibling worktree); a
 * normal `dev` run passes neither and keeps the committed ports.
 */
const appPort = Number(process.env.VITE_APP_PORT ?? PORTS.appPort)
const supervisorPort = Number(
  process.env.VITE_SUPERVISOR_PORT ?? PORTS.supervisorPort,
)

export default defineConfig({
  envDir: "env",
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
    cloudflare({
      viteEnvironment: { name: "ssr" },
      inspectorPort: supervisorPort,
    }),
    //adaptv owns route tree, entries, router, the web manifest, and
    //the service worker — all driven by adaptv.config.ts, the single source of truth
    adaptv(),
    tailwindcss(),
  ],
})
