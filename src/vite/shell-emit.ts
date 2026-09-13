import { existsSync, readdirSync, writeFileSync } from "node:fs"
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
import { emitIntoClientOutput } from "#adaptv/vite/deploy-server.ts"
import { collectRouteTints } from "#adaptv/vite/route-tints.ts"
import { resolveRoutesDir } from "#adaptv/vite/route-tints-module.ts"
import { extractThunkSpecifier } from "#adaptv/vite/thunk-specifiers.ts"

/** Where Vite puts the manifest when `build.manifest` is `true`, not a path. */
const VITE_MANIFEST_FILE = ".vite/manifest.json"

/**
 * The path this plugin asks Vite for when the app asked for no manifest. Its own
 * name is the whole record of who turned the manifest on: Vite resolves the config
 * again for every environment it builds and the earlier answer comes back in the
 * options, so a flag set on the first pass reads "the app asked" on the second.
 */
const SHELL_MANIFEST_FILE = ".vite/adaptv-shell-manifest.json"

type ViteManifest = Record<
  string,
  { file?: string; css?: string[]; isEntry?: boolean; imports?: string[] }
>

/**
 * The entry's static import graph, in manifest order, as public hrefs.
 *
 * The server-rendered document carries a modulepreload link for every chunk
 * the page needs, so the browser fetches them all at once. The shell had only
 * the entry script, so each level of static imports was discovered after the
 * previous level had downloaded and parsed. MEASURED on the built playground,
 * chromium, ten cold boots: the entry finished at 551ms, its nine static
 * imports started at 556ms, and the route chunks could only start at 759ms;
 * the same document with these links reaches its first client render earlier
 * by the width of that middle level. Dynamic imports stay out: they are every
 * route in the app, and the shell serves any of them.
 */
function entryModulepreloadHrefs(manifest: ViteManifest): string[] {
  const entryId = Object.keys(manifest).find((id) => manifest[id]?.isEntry)
  if (!entryId) return []
  const seen = new Set<string>()
  const queue = [...(manifest[entryId]?.imports ?? [])]
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (seen.has(id)) continue
    seen.add(id)
    queue.push(...(manifest[id]?.imports ?? []))
  }
  return [...seen]
    .map((id) => manifest[id]?.file)
    .filter((file): file is string => typeof file === "string")
    .map((file) => `/${file}`)
}

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
 * Emit the app shell into `dist/client`. → `docs/design/rendering.md §3.1.2`
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
 * plugin has written ours (`docs/decisions/register.md` B31) — measured while chasing why an
 * OTA bundle booted the wrong document. The safe rule is the one below: this
 * shell is generated, never adopted, and nothing downstream may prefer Start's
 * copy over it.
 *
 * The shell is **generated** from config, never captured from a rendered
 * response, which is what makes it user-agnostic by construction rather than by
 * discipline. See `app-shell.ts`.
 */
export function adaptvShellEmitPlugin(context: AdaptvContext): Plugin {
  let base = "/"
  let clientManifest: ViteManifest | undefined
  return {
    name: "adaptv:shell-emit",
    apply: "build",
    //The emitted shell has to reference hashed filenames, and the manifest is the
    //only reliable way to learn them. The CLIENT environment only: nothing reads a
    //server build's manifest. `configEnvironment` post, not `config`: it runs after
    //every plugin's `config` hook with the top-level `build` already merged in, so
    //a manifest asked for anywhere (the app's config, or a plugin listed after this
    //one) is seen here, and an app's own manifest setting is left as it wrote it.
    configEnvironment: {
      order: "post",
      handler(name, options) {
        if (name !== "client" || options.build?.manifest) return
        return { build: { manifest: SHELL_MANIFEST_FILE } }
      },
    },
    configResolved(resolved) {
      captureClientOutDir(context, resolved)
      //The emitted shell is served at whatever base the app deploys under, and
      //the route-tint patterns are matched against `location.pathname` — so the
      //base has to be baked into the script here too, not just in the runtime
      //document (`create-root-route.tsx`, which reads `import.meta.env.BASE_URL`).
      base = resolved.base
    },
    //The manifest is read here, out of the bundle, and never written. It is an
    //input to the shell and nothing else: TanStack Start builds its route preloads
    //from the bundle itself, and no server or host reads the file. Written, it was
    //deployed next to the app: 41 KB of source paths in `.output/public` and
    //`dist/client`, listed in the server's public asset table, so every SSR app
    //answered `GET /.vite/manifest.json` with its whole module graph. `order:
    //"post"` puts this after Vite's own manifest hook, which emits the asset in
    //the same phase.
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        if (this.environment.name !== "client") return
        const setting = this.environment.config.build.manifest
        const asset =
          bundle[
            typeof setting === "string" ? setting : VITE_MANIFEST_FILE
          ]
        if (asset?.type !== "asset") return
        clientManifest = JSON.parse(
          typeof asset.source === "string"
            ? asset.source
            : new TextDecoder().decode(asset.source),
        ) as ViteManifest
        //an app that turned the manifest on itself still gets its file
        if (setting === SHELL_MANIFEST_FILE) delete bundle[asset.fileName]
      },
    },
    //Not `closeBundle`, which fires per ENVIRONMENT and is too early: the deploy
    //plugin is still assembling the output directory afterwards. And not only
    //`buildApp` post either, which is too late for a server build that bakes the
    //output into its asset table. → `deploy-server.ts`, `adaptv-plugin.ts`
    ...emitIntoClientOutput(async () => {
      if (clientManifest) await emitShell(context, base, clientManifest)
    }),
  }
}

async function emitShell(
  context: AdaptvContext,
  base: string,
  manifest: ViteManifest,
): Promise<void> {
  const config = requireAppConfig(context)
  const clientDir = requireClientOutDir(context)
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
        //scanned here rather than taken from the virtual module: this plugin
        //runs in Node, outside the module graph. Same function, same table.
        routeTints: collectRouteTints(
          resolveRoutesDir(context.appRoot, config.router.routesDirectory),
        ),
        base,
      }),
    stylesHref,
    entryHref: `/${entry.file}`,
    modulepreloadHrefs: entryModulepreloadHrefs(manifest),
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
