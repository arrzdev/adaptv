import path from "node:path"
import type { ResolvedConfig } from "vite"
import type { AdaptvAppConfig } from "#adaptv/config/app-config"
import type { ResolvedWebConfig } from "#adaptv/config/web-config"

export type LoadedAppConfig = {
  config: AdaptvAppConfig
  /** Absolute paths of every module bundled into the config — dev watch set. */
  watchFiles: string[]
}

/**
 * Shared state between the composed adaptv plugins. Populated by the app-config
 * plugin's `config` hook, which vite runs before every later hook of the other
 * plugins in the array.
 */
export type AdaptvContext = {
  appRoot: string
  loaded: LoadedAppConfig | null
  /**
   * Which lineage this build is. Set once by `adaptv()` from its `target` option
   * (or `ADAPTV_TARGET`), and the thing to branch on when a decision is about
   * *where the bundle is loaded from* rather than how it renders.
   *
   * `render` is the wrong question for that, and answering it wrongly is what
   * shipped `_redirects` and `404.html` inside the `.ipa`: a Capacitor bundle is
   * `render: "spa"` too, so a `render === "spa"` gate cannot tell a static host
   * from a WebView reading files off the device. Everything a browser tab has and
   * a WebView does not — a URL bar, a favicon, an install prompt, an HTTP host —
   * keys off this.
   */
  target: "web" | "capacitor"
  /**
   * The resolved web build settings. Set once by `adaptv()` and read by every
   * downstream plugin, so `render` and the SW settings cannot drift between the
   * router wiring, the manifest and the service-worker build.
   */
  web?: ResolvedWebConfig
  /**
   * Absolute path of the **client** build output. Set from Vite's resolved config
   * by `captureClientOutDir`, never assumed.
   *
   * This was hardcoded to `<appRoot>/dist/client` in three places, which held only
   * while nothing relocated the output. Nitro does: it builds into `.output`, and
   * the hardcoded path made the service-worker build die with
   * `dist/client missing`. That was the good outcome — the same assumption in the
   * precache manifest, which is globbed off disk, could just as easily have
   * produced a worker that precached nothing and failed at runtime instead.
   * → `DECISIONS.md §6.4`
   */
  clientOutDir?: string
}

export function createAdaptvContext(appRoot: string): AdaptvContext {
  return { appRoot, loaded: null, target: "web" }
}

/**
 * Record where the client build actually writes, from Vite's own resolved config.
 *
 * Read off the **client environment** specifically: adaptv's emitters all run on
 * the `ssr` environment's `closeBundle` (that is the only point at which the
 * client output is complete), so `this.environment` there is the wrong one to ask.
 *
 * Idempotent, and every emitter calls it — so no plugin depends on another having
 * run first, which is deliberate: the ordering between them is already
 * load-bearing for other reasons and did not need a second edge.
 */
export function captureClientOutDir(
  context: AdaptvContext,
  config: ResolvedConfig,
): void {
  const outDir = config.environments?.client?.build?.outDir
  if (!outDir) return
  context.clientOutDir = path.resolve(config.root, outDir)
}

/** The client output dir, or a loud failure. Never a `dist/client` guess. */
export function requireClientOutDir(context: AdaptvContext): string {
  if (!context.clientOutDir) {
    throw new Error(
      "[adaptv] the client output directory is unknown — captureClientOutDir must run in configResolved before any emitter",
    )
  }
  return context.clientOutDir
}

/**
 * State an absolute path the way the developer's own files state it.
 *
 * Build output names files a dev can act on, and an absolute one is both noise
 * and a small leak — it is their home directory, in a log they may well paste
 * into an issue. `docs/CLI-UX.md`: **app-root-relative only, never absolute.**
 *
 * One helper rather than a `path.relative` at each call site, because there are
 * several emitters printing the same kind of line and "one idea, two
 * implementations" is how they drift apart.
 */
export function appRelativePath(
  context: AdaptvContext,
  absolute: string,
): string {
  const relative = path.relative(context.appRoot, absolute)
  //Outside the app root — a monorepo sibling, a temp dir. A `../../../..` chain
  //is harder to read than the absolute path it was built from, so leave it
  //alone: this is a legibility rule, not a redaction one.
  if (!relative || relative.startsWith("..")) return absolute
  return relative
}

export function requireAppConfig(context: AdaptvContext): AdaptvAppConfig {
  if (!context.loaded) {
    throw new Error(
      "[adaptv] adaptv.config.ts is not loaded yet — the adaptv() plugins must run together and in order",
    )
  }
  return context.loaded.config
}
