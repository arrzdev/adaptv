// Serving adaptv's own icon set.
//
// When an app has no usable art, `resolveIconSet` hands back adaptv's mark — but those files
// live in the FRAMEWORK's package, not in the app's `public/`, so nothing would serve them.
// Vite's `publicDir` is one directory and it belongs to the consumer; a library cannot add a
// second one. So the icons are served by middleware in dev and emitted as assets at build,
// exactly the way `adaptvManifestPlugin` handles `/manifest.json` next door — same two hooks,
// same reason. → `src/vite/icon-set.ts`
import { readFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { requireAppConfig } from "#adaptv/vite/adaptv-context.ts"
import {
  DEFAULT_ICONS_URL_BASE,
  defaultIconAssets,
  defaultIconFiles,
  resolveIconSet,
} from "#adaptv/vite/icon-set.ts"

const CONTENT_TYPE: Record<string, string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
}

/**
 * Serve / emit `/adaptv-icons/*` — but ONLY for an app that is actually using the default set.
 *
 * The guard matters both ways round. An app with its own icons must not get a dozen files of
 * someone else's brand in its build output; and an app without any must get them at the exact
 * URLs the manifest and head already point at, or the fallback is a set of 404s that looks
 * identical to having shipped nothing.
 */
export function adaptvDefaultIconsPlugin(context: AdaptvContext): Plugin {
  //Resolved per call rather than once: the manifest middleware re-reads the icon directory on
  //every request, so a dev who adds their own art mid-session stops being served adaptv's.
  const usingDefaults = () =>
    resolveIconSet(
      context.appRoot,
      requireAppConfig(context),
      defaultIconFiles(),
    ).source === "default"

  return {
    name: "adaptv:default-icons",

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0]
        if (!url.startsWith(`${DEFAULT_ICONS_URL_BASE}/`)) return next()
        if (!usingDefaults()) return next()

        //`path.basename` and an exact-name match against the known asset list: the URL never
        //reaches the filesystem, so `/adaptv-icons/../../etc/passwd` resolves to `passwd`
        //and simply isn't in the set.
        const name = path.basename(url)
        const file = defaultIconAssets().find(
          (f) => path.basename(f) === name,
        )
        if (!file) return next()

        res.setHeader(
          "Content-Type",
          CONTENT_TYPE[path.extname(name).toLowerCase()] ?? "image/png",
        )
        res.end(readFileSync(file))
      })
    },

    generateBundle() {
      //client environment only — these are client assets, like the manifest.
      if (this.environment.name !== "client") return
      if (!usingDefaults()) return
      for (const file of defaultIconAssets())
        this.emitFile({
          type: "asset",
          //`fileName`, not `name`: the manifest and the head already reference these by
          //their exact path, so they must NOT be hashed into `assets/icon-a1b2c3.png`.
          fileName: `${DEFAULT_ICONS_URL_BASE.slice(1)}/${path.basename(file)}`,
          source: readFileSync(file),
        })
    },
  }
}
