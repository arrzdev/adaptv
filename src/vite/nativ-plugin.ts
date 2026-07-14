import { existsSync } from "node:fs"
import path from "node:path"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import type { PluginOption } from "vite"
import type { NativAppConfig } from "#nativ/config/app-config.ts"
import {
  APP_CONFIG_BASENAME,
  loadAppConfig,
} from "#nativ/vite/app-config-loader.ts"
import { stampCapacitorConfig } from "#nativ/vite/capacitor-config.ts"
import {
  buildManifest,
  nativManifestPlugin,
} from "#nativ/vite/manifest.ts"
import type { NativContext } from "#nativ/vite/nativ-context.ts"
import { createNativContext } from "#nativ/vite/nativ-context.ts"
import { stampGeneratedFiles } from "#nativ/vite/stamp.ts"
import { nativSwBuildPlugin } from "#nativ/vite/sw-build.ts"
import { nativPwaRegisterPlugin } from "#nativ/vite/virtuals.ts"

export type NativOptions = {
  /** App root holding `nativ.config.ts`. Default: `process.cwd()`. */
  appRoot?: string
  /**
   * Build target. `"capacitor"` produces the native shell bundle — forces a static
   * SPA (`render: "spa"`) and disables the service worker (`sw: false`), since a
   * Capacitor WebView loads on-device files (no server to SSR, and the bundle is the
   * offline shell). `"web"` (default) is the untouched SSR/PWA build. Falls back to
   * the `NATIV_TARGET` env var, so `NATIV_TARGET=capacitor vite build` works too.
   */
  target?: "web" | "capacitor"
}

/**
 * The nativ framework plugin — one call in an app's `vite.config.ts`. Reads
 * `nativ.config.ts` (single source of truth) and wires the whole PWA:
 *
 * - stamps the generated root route + router (unless the app ejects by writing
 *   `layouts/_root.tsx` / `router.tsx`)
 * - drives TanStack Start — route tree + entries; the client entry is Start's
 *   default (StrictMode), ejectable by writing `src/client.tsx`
 * - generates the web manifest and the service-worker precache + build tag
 * - serves `virtual:nativ/pwa-register` for the shell
 *
 * Takes no arguments — the build config (`render`, `router` paths) lives in
 * `nativ.config.ts` too. It is an ASYNC plugin factory: it loads
 * the config first (so Start is configured from it and the generated files exist
 * before any hook), then returns the plugin array. Vite awaits plugin promises and
 * flattens nested arrays, so `plugins: [cloudflare(), nativ(), tailwindcss()]`
 * needs no `await` and no spread.
 */
export async function nativ(
  options: NativOptions = {},
): Promise<PluginOption[]> {
  const appRoot = options.appRoot ?? process.cwd()
  const context = createNativContext(appRoot)
  const routerEjected = existsSync(path.resolve(appRoot, "src/router.tsx"))
  const clientEjected = existsSync(path.resolve(appRoot, "src/client.tsx"))

  //load the config up front — Start is configured from it, and the generated
  //root/router files must exist before Start resolves `router.entry`.
  context.loaded = await loadAppConfig(appRoot)

  //capacitor target: one source of truth still, but the native bundle is a static
  //SPA with no service worker. Mutate the loaded config before stamping so the
  //generated root/router, manifest, and SW-build plugin all follow suit.
  const target =
    options.target ??
    (process.env.NATIV_TARGET === "capacitor" ? "capacitor" : "web")
  if (target === "capacitor") {
    context.loaded.config.router.render = "spa"
    context.loaded.config.sw = false
    //generate capacitor.config.json from the config's `appId` — cap reads this; the
    //consumer never hand-writes a Capacitor config. Stamped ONLY for the
    //native target so a plain web `dev`/`build` never materialises it in the app
    //root; the `nativ` CLI always builds this target before invoking cap.
    stampCapacitorConfig(context.loaded.config, appRoot)
  }

  buildManifest(context.loaded.config, appRoot) //fail fast on a bad manifest
  stampGeneratedFiles(context)

  return [
    nativConfigLoaderPlugin(context),
    nativManifestPlugin(context),
    nativPwaRegisterPlugin(),
    tanstackStart(
      deriveStartOptions(
        context.loaded.config,
        routerEjected,
        clientEjected,
      ),
    ),
    viteReact(),
    nativSwBuildPlugin(context),
  ]
}

/** TanStack Start options — mapped from the loaded `nativ.config.ts`; nativ adds the stamped router entry. */
function deriveStartOptions(
  config: NativAppConfig,
  routerEjected: boolean,
  clientEjected: boolean,
) {
  const router = config.router
  const isSpa = (router.render ?? "spa") === "spa"

  return {
    //SPA prerenders a static shell + hydrates on the client; SSR server-renders.
    ...(isSpa ? { spa: { enabled: true } } : {}),
    //no client entry set → Start's built-in default (with StrictMode, recommended).
    //eject to a custom entry (e.g. no StrictMode) by writing `src/client.tsx`.
    ...(clientEjected ? { client: { entry: "./client" } } : {}),
    ...(router.serverEntry
      ? { server: { entry: router.serverEntry } }
      : {}),
    router: {
      generatedRouteTree: router.generatedRouteTree,
      routesDirectory: router.routesDirectory,
      quoteStyle: router.quoteStyle ?? "double",
      virtualRouteConfig: router.virtualRouteConfig,
      //stamped router unless the app ejects with its own `src/router.tsx`.
      ...(routerEjected ? {} : { entry: "./router.gen" }),
    },
  }
}

/**
 * Dev watcher: on a change to `nativ.config.ts` (or a module it imports), re-load
 * the config, re-stamp the generated files, and full-reload. The initial load +
 * stamp happen in the `nativ()` factory. Changing a BUILD option (`render` or the
 * `router` paths) still needs a dev-server restart — those configure Start, which
 * is instantiated once at startup.
 */
function nativConfigLoaderPlugin(context: NativContext): PluginOption {
  return {
    name: "nativ:config-watcher",
    configureServer(server) {
      const configPath = path.resolve(context.appRoot, APP_CONFIG_BASENAME)
      const watched = context.loaded?.watchFiles ?? [configPath]
      server.watcher.add(watched)

      const reload = async (changed: string) => {
        if (
          !(context.loaded?.watchFiles ?? [configPath]).includes(changed)
        ) {
          return
        }
        context.loaded = await loadAppConfig(context.appRoot)
        stampGeneratedFiles(context)
        server.ws.send({ type: "full-reload" })
      }

      server.watcher.on("change", (file) => void reload(file))
    },
  }
}
