import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"
import type { NativAppConfig } from "#nativ/config/app-config.ts"
import { resolveThemeColors } from "#nativ/config/app-config.ts"
import type { NativContext } from "#nativ/vite/nativ-context.ts"
import { requireAppConfig } from "#nativ/vite/nativ-context.ts"

const DEFAULT_ICONS_DIR = "./public/favicons"
const MANIFEST_PATH = "/manifest.json"

export type WebManifestIcon = {
  src: string
  sizes: string
  type: string
  /** `"maskable"` for adaptive icons (safe-zone art on a solid bg), else omitted (any). */
  purpose?: string
}

export type WebManifest = {
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
 * Generates `/manifest.json` from `nativ.config.ts` — served in dev, emitted at
 * build — so the manifest is never a hand-maintained file that drifts from the
 * app's identity/theme config.
 */
export function nativManifestPlugin(context: NativContext): Plugin {
  return {
    name: "nativ:manifest",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== MANIFEST_PATH) return next()
        const manifest = buildManifest(
          requireAppConfig(context),
          context.appRoot,
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
      )
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify(manifest, null, 2),
      })
    },
  }
}

/** Serialized web app manifest, generated from `nativ.config.ts` — no hand-maintained JSON. */
export function buildManifest(
  config: NativAppConfig,
  appRoot: string,
): WebManifest {
  const theme = resolveThemeColors(config.themeColor)
  const manifest: WebManifest = {
    name: config.name,
    short_name: config.shortName ?? config.name,
    description: config.description,
    start_url: "/",
    display: "standalone",
    background_color: config.backgroundColor ?? theme.light,
    //theme_color seeds the installed app's status bar + native splash chrome before
    //JS runs; match the light background so the launch chrome isn't a dark strip on
    //a light splash (useSyncTheme takes over the live theme-color meta once mounted).
    theme_color: theme.light,
    icons: collectIcons(config, appRoot),
    ...config.manifestExtra,
  }

  if (config.orientation && config.orientation !== "any") {
    manifest.orientation = config.orientation
  }

  return manifest
}

function collectIcons(
  config: NativAppConfig,
  appRoot: string,
): WebManifestIcon[] {
  const iconsDirRel = config.icons ?? DEFAULT_ICONS_DIR
  const iconsDirAbs = path.resolve(appRoot, iconsDirRel)
  if (!existsSync(iconsDirAbs)) return []

  const publicDir = path.resolve(appRoot, "public")
  const urlBase = `/${path.relative(publicDir, iconsDirAbs)}`.replaceAll(
    path.sep,
    "/",
  )

  const icons: Array<WebManifestIcon & { order: number }> = []
  for (const filename of readdirSync(iconsDirAbs)) {
    //manifest icons are the maskable/any android set; apple + ms icons are
    //linked from the head, not the manifest.
    if (!filename.startsWith("android-")) continue
    const sizes = parseIconSize(filename)
    if (!sizes) continue
    //`android-maskable-*` are adaptive icons (safe-zone art on a solid brand bg).
    //Modern Android uses the maskable icon for the home-screen AND the generated
    //splash — so a maskable icon whose background matches `background_color` means
    //the splash has no white matte box (the default for a plain, non-maskable icon).
    const isMaskable = filename.startsWith("android-maskable-")
    icons.push({
      src: `${urlBase}/${filename}`,
      sizes,
      type: "image/png",
      ...(isMaskable ? { purpose: "maskable" } : {}),
      order: Number.parseInt(sizes, 10),
    })
  }

  //maskable last so a consumer's icon picker that takes the first match still gets
  //an `any` icon, while Android's splash/adaptive path finds the maskable set.
  icons.sort(
    (a, b) =>
      a.order - b.order || (a.purpose ? 1 : 0) - (b.purpose ? 1 : 0),
  )
  return icons.map(({ order: _order, ...icon }) => icon)
}

/** `android-icon-36x36.png` → `36x36`; `android-chrome-192.png` → `192x192`. */
export function parseIconSize(filename: string): string | null {
  const explicit = filename.match(/(\d+)x(\d+)/)
  if (explicit) return `${explicit[1]}x${explicit[2]}`

  const square = filename.match(/-(\d+)\.(?:png|webp)$/)
  if (square) return `${square[1]}x${square[1]}`

  return null
}
