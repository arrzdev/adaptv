import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"
import { resolveThemeColors } from "#adaptv/config/app-config.ts"
import { appShellFile } from "#adaptv/config/sw-helpers.ts"
import { getCriticalShellCss } from "#adaptv/shell/critical-css.ts"
import { getUiThemeInitScript } from "#adaptv/shell/theme-init-script.ts"
import { getPlatformInitScript } from "#adaptv/utils/platform.ts"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import {
  appRelativePath,
  captureClientOutDir,
  requireAppConfig,
  requireClientOutDir,
} from "#adaptv/vite/adaptv-context.ts"
import { renderAppShell } from "#adaptv/vite/app-shell.ts"
import { prerenderBootFallback } from "#adaptv/vite/boot-fallback-prerender.ts"
import { extractThunkSpecifier } from "#adaptv/vite/thunk-specifiers.ts"

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
 * Emit the app shell into `dist/client`. → `RENDERING.md §3.1.2`
 *
 * Named `index.html` for a SPA build and `adaptv-shell.html` for an SSR one; the
 * reasoning for the split lives with the constants in `sw-helpers.ts`.
 *
 * Two features depend on the file existing — a `render: "spa"` deploy (needs a
 * document for every path) and the SSR service worker's precache fallback (binds
 * to a shell URL; without the file the offline path 404s instead of booting
 * React) — and Start cannot be relied on to produce it: with the Cloudflare
 * adapter it emits no HTML at all.
 *
 * ⚠︎ Where it *does* emit, it emits **late**, so "Start emits nothing here" is
 * not a safe blanket assumption. At `render: "ssr"` built for the Capacitor
 * target, Start's prerender writes its own shell about a second AFTER this
 * plugin has written ours (`DECISIONS.md` B31) — measured while chasing why an
 * OTA bundle booted the wrong document. The safe rule is the one below: this
 * shell is generated, never adopted, and nothing downstream may prefer Start's
 * copy over it.
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
    configResolved(resolved) {
      captureClientOutDir(context, resolved)
    },
    //`buildApp`, not `closeBundle`, and `order: "post"` — see the note in
    //`adaptv-plugin.ts`. `closeBundle` fires per ENVIRONMENT, which is too early:
    //a deploy plugin can still be assembling the output directory afterwards.
    buildApp: {
      order: "post",
      async handler() {
        await emitShell(context)
      },
    },
  }
}

async function emitShell(context: AdaptvContext): Promise<void> {
  const config = requireAppConfig(context)
  const clientDir = requireClientOutDir(context)
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

  //Prerendered, because this is the one screen that has to survive its own
  //build being broken. NOT fatal when it fails: an app must still ship
  //without its boot fallback — but loudly, because a silently absent safety
  //net is indistinguishable from a working one until the day it matters.
  let bootFallbackByCode: Record<string, string> | undefined
  try {
    bootFallbackByCode = await prerenderBootFallback({
      appRoot: context.appRoot,
      specifier: config.bootErrorScreen
        ? extractThunkSpecifier("bootErrorScreen", config.bootErrorScreen)
        : null,
    })
  } catch (error) {
    console.warn(
      `[adaptv] could not prerender the boot error screen — a broken bundle will show a blank page instead: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  const html = renderAppShell({
    lang: config.lang ?? "en",
    title: config.title ?? config.name,
    criticalCss: getCriticalShellCss(
      theme.light,
      theme.dark,
      config.splashScreenInBrowser ?? false,
    ),
    //platform stamp first, then theme — both must resolve before first paint.
    //the ui app-feel stamps are part of the platform script, so the emitted
    //shell resolves them identically to the runtime document.
    headInitScript:
      getPlatformInitScript(config.ui) +
      getUiThemeInitScript({
        themeColorLight: theme.light,
        themeColorDark: theme.dark,
        defaultThemePreference: config.defaultThemePreference ?? "system",
      }),
    stylesHref,
    entryHref: `/${entry.file}`,
    headExtra: '<link rel="manifest" href="/manifest.json">',
    bootFallbackByCode,
  })

  //`index.html` in a SPA build, `adaptv-shell.html` in an SSR one — the SSR
  //shell must not be a directory index, or an asset-first host serves it for
  //`/` instead of running the server. → `sw-helpers.ts`
  const shellFile = appShellFile(context.web?.render ?? "ssr")
  writeFileSync(path.join(clientDir, shellFile), html)
  console.log(
    `[adaptv] wrote ${appRelativePath(context, path.join(clientDir, shellFile))} (app shell)`,
  )
}
