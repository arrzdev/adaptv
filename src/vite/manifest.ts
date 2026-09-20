import type { Plugin } from "vite"
import type { AdaptvAppConfig } from "#adaptv/config/app-config.ts"
import { resolveThemeColors } from "#adaptv/config/app-config.ts"
import { publicPath } from "#adaptv/utils/public-path.ts"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { requireAppConfig } from "#adaptv/vite/adaptv-context.ts"
import type { IconFile, WebManifestIcon } from "#adaptv/vite/icon-set.ts"
import {
  defaultIconFiles,
  manifestIcons,
  resolveIconSet,
} from "#adaptv/vite/icon-set.ts"

export type { WebManifestIcon }

export type WebManifest = {
  id: string
  name: string
  short_name: string
  description: string
  start_url: string
  display: string
  orientation?: string
  background_color: string
  theme_color: string
  icons: WebManifestIcon[]
} & Record<string, unknown>

/**
 * Generates `<base>manifest.json` from `adaptv.config.ts` — served in dev, emitted
 * at build — so the manifest is never a hand-maintained file that drifts from the
 * app's identity/theme config.
 */
export function adaptvManifestPlugin(context: AdaptvContext): Plugin {
  let base = "/"
  return {
    name: "adaptv:manifest",
    configResolved(resolved) {
      base = resolved.base
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== publicPath(base, "manifest.json")) return next()
        const manifest = buildManifest(
          requireAppConfig(context),
          context.appRoot,
          base,
        )
        res.setHeader("Content-Type", "application/manifest+json")
        res.end(JSON.stringify(manifest, null, 2))
      })
    },
    generateBundle() {
      //client environment only — the manifest is a client asset.
      if (this.environment.name !== "client") return
      const manifest = buildManifest(
        requireAppConfig(context),
        context.appRoot,
        base,
      )
      //The manifest still ships to the native target — `useManifestOrientation`
      //fetches it on device so the iOS guard mirrors the same `orientation`
      //value Android enforces natively. Its ICONS do not: `native-bundle.ts`
      //deletes that art from this bundle, and a WebView has no install prompt or
      //shortcut to read it with, so the array would be nothing but dangling
      //hrefs inside the app.
      if (context.target === "capacitor") manifest.icons = []
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify(manifest, null, 2),
      })
    },
  }
}

/**
 * Serialized web app manifest, generated from `adaptv.config.ts` — no hand-maintained JSON.
 *
 * `defaultIcons` is adaptv's own set, used when the app has none of its own. It DEFAULTS to the
 * real one rather than to `[]`: this function has two call sites — the dev middleware and
 * `generateBundle` — and when passing the set was each caller's job, one of them was written
 * without it and shipped `"icons": []` in every production manifest while dev looked perfect.
 * Tests that want the no-fallback behaviour pass `[]` explicitly.
 *
 * `base` is the deploy base, and every URL in the manifest lives under it. Under
 * `base: "/app/"` a `start_url` of `/` launches the installed app at the origin
 * root, outside its own scope, and `/favicons/…` icons 404 — so the install
 * prompt has no icon to offer.
 */
export function buildManifest(
  config: AdaptvAppConfig,
  appRoot: string,
  base: string,
  defaultIcons: IconFile[] = defaultIconFiles(),
): WebManifest {
  const theme = resolveThemeColors(config.themeColor)
  const manifest: WebManifest = {
    //The install's identity, and the reason it is here rather than left out:
    //without it a browser identifies the installed app by its start_url, so
    //changing the landing route turns an update into a SECOND installed app.
    //Pinned to the origin root, which start_url also is, so the two agree.
    id: "/",
    name: config.name,
    short_name: config.shortName ?? config.name,
    description: config.description,
    start_url: publicPath(base, ""),
    display: "standalone",
    background_color: config.backgroundColor ?? theme.light,
    //theme_color seeds the installed app's status bar + native splash chrome before
    //JS runs; match the light background so the launch chrome isn't a dark strip on
    //a light splash (useSyncTheme takes over the live theme-color meta once mounted).
    theme_color: theme.light,
    //Read from the icon directory on EVERY call — the dev middleware runs per request and the
    //build runs per bundle, so an icon added mid-session shows up in the served manifest
    //without a restart, and `dev`, `preview` and `build` can never disagree about the set.
    //an icon set's `urlBase` is a path under the app's public root, so the
    //URL is that path under the base
    icons: manifestIcons(
      resolveIconSet(appRoot, config, defaultIcons),
    ).map((icon) => ({ ...icon, src: publicPath(base, icon.src) })),
    ...config.manifestExtra,
  }

  if (config.orientation && config.orientation !== "any") {
    manifest.orientation = config.orientation
  }

  return manifest
}
