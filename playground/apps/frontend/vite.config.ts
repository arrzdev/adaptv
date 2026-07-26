import { adaptv } from "@arrzdev/adaptv/vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import { PORTS } from "./ports"

const { appPort, supervisorPort } = PORTS

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
