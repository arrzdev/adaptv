import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build as esbuild } from "esbuild"
import type { Plugin } from "vite"
import { injectManifest } from "workbox-build"
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
 * Runs in `buildApp` at `order: "post"` — after every environment AND after the
 * deploy plugin has finished assembling the output — and **after** the shell-emit
 * plugin. See the ordering note in `adaptv-plugin.ts`; both halves are
 * load-bearing.
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
    //`buildApp`, `order: "post"` — MEASURED, and the reason is the precache
    //manifest. On `closeBundle` the deploy plugin has not finished assembling the
    //output yet: the glob ran against a directory still missing everything from
    //`public/`, and the worker shipped with **21 files silently absent** —
    //favicons, the offline illustrations, robots.txt. No error, no warning; it
    //only shows up as a broken offline render. → `adaptv-plugin.ts`
    buildApp: {
      order: "post",
      async handler() {
        await buildServiceWorker(context, base)
      },
    },
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
 */
function injectPrecacheManifest(options: {
  swSrcBundle: string
  swDest: string
  clientDir: string
  shellFile: string
}) {
  return injectManifest({
    swSrc: options.swSrcBundle,
    swDest: options.swDest,
    globDirectory: options.clientDir,
    globPatterns: [...DEFAULT_SW_GLOB_PATTERNS, options.shellFile],
    globIgnores: [...DEFAULT_SW_GLOB_IGNORES],
    maximumFileSizeToCacheInBytes: DEFAULT_SW_MAX_FILE_BYTES,
  })
}
