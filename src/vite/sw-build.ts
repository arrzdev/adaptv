import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build as esbuild } from "esbuild"
import type { Plugin } from "vite"
import { injectManifest } from "workbox-build"
import type { AdaptvAppConfig } from "#adaptv/config/app-config.ts"
import {
  appShellFile,
  DEFAULT_SW_GLOB_IGNORES,
  DEFAULT_SW_GLOB_PATTERNS,
  DEFAULT_SW_MAX_FILE_BYTES,
} from "#adaptv/config/sw-helpers.ts"
import { publicPath } from "#adaptv/utils/public-path.ts"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import {
  appRelativePath,
  captureClientOutDir,
  requireAppConfig,
  requireClientOutDir,
} from "#adaptv/vite/adaptv-context.ts"
import { resolveGeneratedPaths } from "#adaptv/vite/adaptv-dir.ts"
import { computeBuildTag, slugifyName } from "#adaptv/vite/build-tag.ts"
import { emitIntoClientOutput } from "#adaptv/vite/deploy-server.ts"
import {
  defaultIconFiles,
  headIconLinks,
  resolveIconSet,
} from "#adaptv/vite/icon-set.ts"
import { buildManifest } from "#adaptv/vite/manifest.ts"

/**
 * adaptv's own worker — a real module in the package, never generated.
 *
 * Resolved lazily: at module scope `import.meta.url` is not always a `file:` URL
 * (vitest serves modules over http), and a top-level `fileURLToPath` there throws
 * on import, taking down every suite that merely imports the plugin barrel.
 */
function adaptvWorkerPath(): string {
  return fileURLToPath(new URL("../sw/default-worker.ts", import.meta.url))
}

/**
 * Build the service worker. → `docs/design/rendering.md §3`
 *
 * Runs once the client output is complete and before a server build bakes it
 * (`emitIntoClientOutput`) — and **after** the shell-emit plugin. See the
 * ordering note in `adaptv-plugin.ts`; both halves are load-bearing.
 *
 * adaptv's worker is always the entry. An app never replaces it and never turns
 * it off; the modules an app names in `serviceWorkers` are appended after it. An
 * EMPTY `serviceWorkers` array contributes nothing and the entry stays adaptv's
 * own worker file — see {@link resolveWorkerEntry}.
 */
export function adaptvSwBuildPlugin(context: AdaptvContext): Plugin {
  let base = "/"
  return {
    name: "adaptv:sw-build",
    apply: "build",
    configResolved(resolved) {
      captureClientOutDir(context, resolved)
      //the worker is served from `<base>sw.js` and scoped to `<base>`, so every
      //path it binds or matches lives under the same prefix
      base = resolved.base
    },
    //MEASURED twice, in both directions. On `closeBundle` the deploy plugin has
    //not finished assembling the output yet: the glob ran against a directory
    //still missing everything from `public/`, and the worker shipped with **21
    //files silently absent** — favicons, the offline illustrations, robots.txt.
    //Only in `buildApp` post it was too late instead: the node server had already
    //baked its asset table and answered 404 at `/sw.js`. → `deploy-server.ts`
    ...emitIntoClientOutput(() => buildServiceWorker(context, base)),
  }
}

async function buildServiceWorker(
  context: AdaptvContext,
  base: string,
): Promise<void> {
  const config = requireAppConfig(context)
  //The ONLY case with no worker, and it comes from the target, not a key.
  if (context.web?.sw.enabled === false) return

  const clientDir = requireClientOutDir(context)
  const render = context.web?.render ?? "ssr"
  const shellFile = appShellFile(render)
  const shellPath = path.join(clientDir, shellFile)

  if (!existsSync(clientDir)) {
    throw new Error(
      `[adaptv] ${clientDir} missing — the client build must finish before the service worker is generated`,
    )
  }
  //Ordering guard, not a sanity check. If the shell is emitted after this
  //plugin the manifest is built without it, and the resulting worker fails
  //at RUNTIME in a way no build output reveals.
  if (!existsSync(shellPath)) {
    throw new Error(
      `[adaptv] the app shell (${shellFile}) is missing from ${clientDir} — it must be emitted before the service worker is built`,
    )
  }

  const swEntry = resolveWorkerEntry(context, config.serviceWorkers)
  const buildTag = await computeBuildTag(
    clientDir,
    slugifyName(config.name),
  )
  const swSrcBundle = path.join(clientDir, "sw-src.js")
  const swDest = path.join(clientDir, "sw.js")

  const bundleResult = await esbuild({
    entryPoints: [swEntry],
    outfile: swSrcBundle,
    format: "iife",
    target: "es2020",
    bundle: true,
    minify: true,
    //A service worker IS side effects — every line of it registers a
    //listener or a route. adaptv's package.json narrows `sideEffects` to CSS
    //for the React surface, which is right there and wrong here: with the
    //generated entry, esbuild honoured it and dropped `import
    //"<default-worker>"` entirely, producing a worker with no
    //`self.__WB_MANIFEST` to inject into.
    ignoreAnnotations: true,
    define: {
      __ADAPTV_BUILD_TAG__: JSON.stringify(buildTag),
      //the render mode the app was actually built with
      __ADAPTV_RENDER_MODE__: JSON.stringify(render),
      //The shell URL the navigation route binds to. A `define` rather than a
      //literal in the worker, because the name now varies with the render
      //mode — and the worker binding one name while the build emitted another
      //fails only at RUNTIME, offline, where nobody is watching. Under the
      //base, like everything else the worker binds: a root-absolute shell URL
      //under `base: "/app/"` is a precache miss, so a SPA worker throws
      //`non-precached-url` and an SSR one has nothing to fall back to.
      __ADAPTV_APP_SHELL_URL__: JSON.stringify(
        publicPath(base, shellFile),
      ),
      //the deploy base, which the navigation denylist and the asset matcher
      //resolve their default prefixes under
      __ADAPTV_BASE__: JSON.stringify(publicPath(base, "")),
    },
  })

  if (bundleResult.errors.length > 0) {
    throw new Error(
      `[adaptv] service worker bundle failed: ${bundleResult.errors.map((error) => error.text).join(", ")}`,
    )
  }

  const { warnings } = await injectPrecacheManifest({
    swSrcBundle,
    swDest,
    clientDir,
    shellFile,
    unlinkedIcons: unlinkedIconFiles(context.appRoot, config, base),
  })

  unlinkSync(swSrcBundle)

  for (const message of warnings) {
    console.warn(`[adaptv] ${message}`)
  }

  console.log(
    `[adaptv] wrote ${appRelativePath(context, swDest)} (build tag ${buildTag})`,
  )
}

/**
 * The esbuild entry: adaptv's worker alone, or a generated module that pulls in
 * adaptv's worker and then the app's.
 *
 * Order is the contract. adaptv's setup runs first, so its precache and
 * navigation routes are registered first — and Workbox returns the FIRST
 * matching route, so an app module can add handlers but cannot take delivery
 * away from the framework.
 */
function resolveWorkerEntry(
  context: AdaptvContext,
  serviceWorkers: string[] | undefined,
): string {
  const adaptvWorker = adaptvWorkerPath()
  if (!serviceWorkers || serviceWorkers.length === 0) return adaptvWorker

  const modules = serviceWorkers.map((entry) => {
    const absolute = path.resolve(context.appRoot, entry)
    if (!existsSync(absolute)) {
      throw new Error(
        `[adaptv] serviceWorkers: "${entry}" does not exist (resolved to ${absolute})`,
      )
    }
    return absolute
  })

  const { swGen } = resolveGeneratedPaths(context.appRoot)
  mkdirSync(path.dirname(swGen), { recursive: true })
  writeFileSync(
    swGen,
    [
      "//GENERATED by adaptv — do not edit. Rewritten on every build.",
      "//adaptv's worker first, then this app's modules from `serviceWorkers`.",
      ...[adaptvWorker, ...modules].map(
        (module) => `import ${JSON.stringify(module)}`,
      ),
      "",
    ].join("\n"),
  )
  return swGen
}

/**
 * Stamp the Workbox precache manifest into the bundled worker.
 *
 * The glob covers every hashed build asset — that is what makes an installed PWA
 * navigate like the native build — and the shell is appended **by name**. Adding
 * `**\/*.html` instead would sweep in every prerendered route document, which is
 * exactly the cross-user leak the split exists to prevent. → `docs/design/rendering.md §3.2`
 *
 * The icon art no web surface links is then taken back out — see
 * {@link unlinkedIconFiles}. A manifest transform rather than `globIgnores`,
 * because the names come from the app's directory and a glob would read a `[`
 * or a `(` in one of them as syntax; an exact URL match cannot.
 */
function injectPrecacheManifest(options: {
  swSrcBundle: string
  swDest: string
  clientDir: string
  shellFile: string
  unlinkedIcons: ReadonlySet<string>
}) {
  return injectManifest({
    swSrc: options.swSrcBundle,
    swDest: options.swDest,
    globDirectory: options.clientDir,
    globPatterns: [...DEFAULT_SW_GLOB_PATTERNS, options.shellFile],
    globIgnores: [...DEFAULT_SW_GLOB_IGNORES],
    maximumFileSizeToCacheInBytes: DEFAULT_SW_MAX_FILE_BYTES,
    manifestTransforms: [
      async (entries) => ({
        manifest: entries.filter(
          (entry) => !options.unlinkedIcons.has(entry.url),
        ),
        warnings: [],
      }),
    ],
  })
}

/**
 * The icon files the precache must NOT carry, as client-output-relative URLs.
 *
 * The icon directory has to live inside `public/` so the head and the manifest
 * can point at it (`resolveIconSet`), which puts ALL of it in the glob — and most
 * of it is native source art no browser ever asks for: the 1024px master, the
 * iOS 18 dark and tinted appearances, Android's monochrome layer, the maskable
 * master, and any same-size duplicate the head and manifest tie-break away.
 * MEASURED on the playground: 909 900 of the precache's 3 749 343 bytes (24%),
 * downloaded by every first install for nothing.
 *
 * Derived from what the web surfaces actually link rather than from names: a
 * measured icon is precached if and only if `headIconLinks` or the built
 * manifest points at it, so a custom file name, adaptv's default set and a
 * duplicate 512 are all decided by the same rule the head and the manifest
 * already apply. The manifest is the built one (`buildManifest`), so an `icons`
 * array an app supplies through `manifestExtra` keeps its files too.
 *
 * The two halves are compared differently, because they are different kinds of
 * string. A head link's href is a path under the public root by construction
 * (`${urlBase}/${name}`) and never carries the deploy base, so it is compared
 * from the root whatever the base is. A manifest `src` is a URL the browser
 * resolves against the manifest, which lives at the deploy base, so
 * `./favicons/x.png`, `favicons/x.png`, `<base>favicons/x.png` and an absolute
 * URL on the app's `origin` all name the same output file, and one on any other
 * origin names none.
 *
 * Only the members `resolveIconSet` measured are candidates. Anything else in the
 * directory (a `safari-pinned-tab.svg`, an `.ico` the head does not probe for) is
 * not art adaptv knows the use of, so it is left to the glob. Nothing is removed
 * from the OUTPUT: an unlinked file is still served. The worker's runtime static
 * route (§3.3) caches it only if a page requests it as an image while online,
 * and never on the install alone.
 */
function unlinkedIconFiles(
  appRoot: string,
  config: AdaptvAppConfig,
  base: string,
): ReadonlySet<string> {
  const set = resolveIconSet(appRoot, config, defaultIconFiles())
  //Outside `public/` nothing is served, so nothing of it was globbed either.
  if (!set.urlBase) return new Set()

  const publicRoot = new URL(`${PLACEHOLDER_ORIGIN}/`)
  const manifestRoot = deployRoot(base, config.origin)
  const manifest = buildManifest(config, appRoot, base)
  const manifestSrcs = Array.isArray(manifest.icons)
    ? manifest.icons.map((icon) => icon?.src)
    : []
  const linked = new Set(
    [
      ...headIconLinks(set).map((link) =>
        outputUrl(link.href, publicRoot),
      ),
      ...manifestSrcs.map((src) =>
        typeof src === "string" ? outputUrl(src, manifestRoot) : undefined,
      ),
    ].filter((url): url is string => url !== undefined),
  )

  return new Set(
    set.icons
      .map((icon) => outputUrl(`${set.urlBase}/${icon.name}`, publicRoot))
      .filter(
        (url): url is string => url !== undefined && !linked.has(url),
      ),
  )
}

/**
 * Stands in for the deploy origin when the app names none. It is never a real
 * host, so an absolute URL can only match it by being on the app's own `origin`.
 */
const PLACEHOLDER_ORIGIN = "https://adaptv.invalid"

/**
 * The URL the client output is served at: Vite's resolved `base` on the app's
 * `origin`. Vite keeps a trailing slash only when one was written, so `/app` and
 * `/app/` are the same root; a relative base (`./`) resolves to the origin root,
 * the one place its relative URLs can be compared from; an absolute base (a CDN)
 * carries its own origin.
 */
function deployRoot(base: string, origin: string | undefined): URL {
  const prefix = base.endsWith("/") ? base : `${base}/`
  try {
    return new URL(prefix, `${origin ?? PLACEHOLDER_ORIGIN}/`)
  } catch {
    return new URL(prefix, `${PLACEHOLDER_ORIGIN}/`)
  }
}

/**
 * The output file an href names, the way Workbox writes a manifest URL: the path
 * relative to the client output, no leading slash, not percent-encoded (Workbox
 * takes it from the disk, and the head and manifest write file names unencoded).
 * `undefined` when the href resolves to another origin or outside `root`, where
 * nothing in the output can be at.
 */
function outputUrl(href: string, root: URL): string | undefined {
  try {
    const url = new URL(href, root)
    if (url.origin !== root.origin) return undefined
    if (!url.pathname.startsWith(root.pathname)) return undefined
    return decodeURIComponent(url.pathname.slice(root.pathname.length))
  } catch {
    return undefined
  }
}
