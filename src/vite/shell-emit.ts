import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"
import { resolveThemeColors } from "#adaptv/config/app-config.ts"
import { getCriticalShellCss } from "#adaptv/shell/critical-css.ts"
import { getUiThemeInitScript } from "#adaptv/shell/theme-init-script.ts"
import { getPlatformInitScript } from "#adaptv/utils/platform.ts"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { requireAppConfig } from "#adaptv/vite/adaptv-context.ts"
import { renderAppShell } from "#adaptv/vite/app-shell.ts"

type ViteManifest = Record<
  string,
  { file?: string; css?: string[]; isEntry?: boolean }
>

/**
 * The app stylesheet's public href, resolved defensively.
 *
 * Order: the entry chunk's css → any chunk's css → a scan of `assets/` for a
 * `.css` file. The last two matter because the SPA client manifest can emit the
 * stylesheet without linking it to a chunk (Start handles CSS through its
 * prerender), and an empty result previously produced `href="/"` — which loads
 * the HTML document as a stylesheet and leaves the app completely unstyled.
 * Returns `""` only if the build genuinely produced no CSS.
 */
function resolveStylesHref(
  manifest: ViteManifest,
  clientDir: string,
): string {
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry)
  const fromManifest =
    entry?.css?.[0] ??
    Object.values(manifest).find((chunk) => chunk.css?.length)?.css?.[0]
  if (fromManifest) return `/${fromManifest}`

  const assetsDir = path.join(clientDir, "assets")
  if (existsSync(assetsDir)) {
    const css = readdirSync(assetsDir).find((f) => f.endsWith(".css"))
    if (css) return `/assets/${css}`
  }
  return ""
}

/**
 * Emit `dist/client/index.html` — the app shell. → `RENDERING.md §3.1.2`
 *
 * Measured: TanStack Start emits no HTML in this configuration, so there is
 * nothing to copy and two features depend on the file existing — `host: "static"`
 * (needs a document for every path) and the SSR service worker's precache
 * fallback (binds to a shell URL; without the file the offline path 404s instead
 * of booting React).
 *
 * The shell is **generated** from config, never captured from a rendered
 * response, which is what makes it user-agnostic by construction rather than by
 * discipline. See `app-shell.ts`.
 */
export function adaptvShellEmitPlugin(context: AdaptvContext): Plugin {
  return {
    name: "adaptv:shell-emit",
    apply: "build",
    config() {
      //the emitted shell has to reference hashed filenames, and the manifest is
      //the only reliable way to learn them
      return { build: { manifest: true } }
    },
    applyToEnvironment(environment) {
      //after the LAST environment — the client build writes the manifest
      return environment.name === "ssr"
    },
    closeBundle() {
      const config = requireAppConfig(context)
      const clientDir = path.resolve(context.appRoot, "dist/client")
      const manifestPath = path.join(clientDir, ".vite", "manifest.json")
      if (!existsSync(manifestPath)) return

      const manifest = JSON.parse(
        readFileSync(manifestPath, "utf8"),
      ) as ViteManifest
      const entry = Object.values(manifest).find((chunk) => chunk.isEntry)
      if (!entry?.file) return

      //Resolve the app stylesheet href. The entry chunk usually carries it, but
      //in the SPA build the client manifest can leave the CSS unassociated to any
      //chunk (Start routes CSS through its prerender). So fall back: any chunk's
      //css, then a scan of the assets dir. Missing this shipped `href="/"`, which
      //loads index.html as a stylesheet — a fully unstyled app.
      const stylesHref = resolveStylesHref(manifest, clientDir)

      const theme = resolveThemeColors(config.themeColor)
      const html = renderAppShell({
        lang: config.lang ?? "en",
        title: config.title ?? config.name,
        criticalCss: getCriticalShellCss(
          theme.light,
          theme.dark,
          config.splashScreenInBrowser ?? false,
        ),
        //platform stamp first, then theme — both must resolve before first paint
        headInitScript:
          getPlatformInitScript() +
          getUiThemeInitScript({
            themeColorLight: theme.light,
            themeColorDark: theme.dark,
            defaultThemePreference:
              config.defaultThemePreference ?? "system",
          }),
        stylesHref,
        entryHref: `/${entry.file}`,
        headExtra: '<link rel="manifest" href="/manifest.json">',
      })

      writeFileSync(path.join(clientDir, "index.html"), html)
      console.log("[adaptv] wrote dist/client/index.html (app shell)")
    },
  }
}
