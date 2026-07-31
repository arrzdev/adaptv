import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import type { PluginOption } from "vite"
import type { AdaptvAppConfig } from "#adaptv/config/app-config.ts"
import type { ResolvedWebConfig } from "#adaptv/config/web-config.ts"
import { resolveWebConfig } from "#adaptv/config/web-config.ts"
import { stampPrivacyManifest } from "#adaptv/native/stamp-privacy.ts"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { createAdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import {
  resolveGeneratedPaths,
  resolveGeneratedTmpDir,
} from "#adaptv/vite/adaptv-dir.ts"
import { adaptvImagePlugin } from "#adaptv/vite/adaptv-image.ts"
import {
  APP_CONFIG_BASENAME,
  loadAppConfig,
} from "#adaptv/vite/app-config-loader.ts"
import { adaptvBanServerApisPlugin } from "#adaptv/vite/ban-server-apis.ts"
import { adaptvCssLayerOrderPlugin } from "#adaptv/vite/css-layer-order.ts"
import { adaptvDefaultIconsPlugin } from "#adaptv/vite/default-icons.ts"
import {
  adaptvManifestPlugin,
  buildManifest,
} from "#adaptv/vite/manifest.ts"
import { adaptvRingShadowPlugin } from "#adaptv/vite/ring-shadow-fallback.ts"
import { adaptvRootRoutePlugin } from "#adaptv/vite/root-route-module.ts"
import { adaptvOpacityCheckPlugin } from "#adaptv/vite/route-tree-opacity.ts"
import {
  adaptvRouteAutoImportPlugin,
  stripTanStackAutoImport,
} from "#adaptv/vite/router-autoimport.ts"
import { adaptvShellEmitPlugin } from "#adaptv/vite/shell-emit.ts"
import { stampGeneratedFiles } from "#adaptv/vite/stamp.ts"
import { adaptvStaticHostPlugin } from "#adaptv/vite/static-host.ts"
import { adaptvSwBuildPlugin } from "#adaptv/vite/sw-build.ts"
import { adaptvPwaRegisterPlugin } from "#adaptv/vite/virtuals.ts"

/** Default specifier for every generated import. Overridable for aliased installs. */
const DEFAULT_ROUTER_SPECIFIER = "@arrzdev/adaptv/router"

export type AdaptvOptions = {
  /** App root holding `adaptv.config.ts`. Default: `process.cwd()`. */
  appRoot?: string
  /**
   * Build target. `"capacitor"` produces the native shell bundle — forces a static
   * SPA (`render: "spa"`) and disables the service worker (`sw: false`), since a
   * Capacitor WebView loads on-device files (no server to SSR, and the bundle is the
   * offline shell). `"web"` (default) is the untouched SSR/PWA build. Falls back to
   * the `ADAPTV_TARGET` env var, so `ADAPTV_TARGET=capacitor vite build` works too.
   */
  target?: "web" | "capacitor"
  /**
   * The specifier route files import the route factory from. Default
   * `"@arrzdev/adaptv/router"`.
   *
   * Exists because the package is not always reachable under its published name:
   * a monorepo may alias it (`@arrzdev/adaptv`), and the injected import has to be
   * something the consumer's own resolver can actually follow. Getting it wrong
   * fails loudly at build time with an unresolved import, which is the right
   * failure mode.
   */
  routerSpecifier?: string
}

/**
 * The adaptv framework plugin — one call in an app's `vite.config.ts`. Reads
 * `adaptv.config.ts` (single source of truth) and wires the whole PWA:
 *
 * - stamps the generated root route + router (unless the app ejects by writing
 *   `layouts/_root.tsx` / `router.tsx`)
 * - drives TanStack Start — route tree + entries; the client entry is Start's
 *   default (StrictMode), ejectable by writing `src/client.tsx`
 * - generates the web manifest and the service-worker precache + build tag
 * - serves `virtual:adaptv/pwa-register` for the shell
 *
 * Takes no arguments — the build config (`render`, `router` paths) lives in
 * `adaptv.config.ts` too. It is an ASYNC plugin factory: it loads
 * the config first (so Start is configured from it and the generated files exist
 * before any hook), then returns the plugin array. Vite awaits plugin promises and
 * flattens nested arrays, so `plugins: [cloudflare(), adaptv(), tailwindcss()]`
 * needs no `await` and no spread.
 */
export async function adaptv(
  options: AdaptvOptions = {},
): Promise<PluginOption[]> {
  const appRoot = options.appRoot ?? process.cwd()
  const context = createAdaptvContext(appRoot)
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
    (process.env.ADAPTV_TARGET === "capacitor" ? "capacitor" : "web")
  //The adaptv CLI's live-reload dev server (`adaptv dev ios|android`) sets this: the
  //bundle is served into a native WebView, which can't hydrate SSR — so force a
  //client SPA. (The service worker is handled at runtime — it never registers in
  //dev, see service-worker-shell.ts — so no build-time override is needed.) The
  //plain `web` target is kept otherwise, so an SSR/cloudflare dev pipeline still runs.
  if (target === "web" && process.env.ADAPTV_DEV_NATIVE === "1") {
    context.loaded.config.router.render = "spa"
  }
  //One resolution, used by every downstream plugin — so `render`, `host` and the
  //SW settings cannot drift between the router wiring, the manifest and the SW
  //build. The capacitor target is an OVERRIDE inside this call, not a default.
  const web = resolveWebConfig(context.loaded.config, target)
  context.web = web

  if (target === "capacitor") {
    context.loaded.config.router.render = "spa"
    context.loaded.config.sw = false
    //No capacitor.config.json is written: the `adaptv` CLI passes the generated config to
    //cap in-memory via the ADAPTV_CAPACITOR_CONFIG env var (its patched @capacitor/cli reads
    //it there), so the consumer's project never carries a Capacitor config file.
    //Apple's required-reason API manifest, derived from the installed plugins.
    //Not one of the 22 official Capacitor plugins ships one, the obligation lands
    //on the app, and a missing manifest fails SILENTLY at App Store submission.
    //→ DECISIONS.md §5.0.1
    const privacyManifest = stampPrivacyManifest(appRoot)
    if (privacyManifest) {
      console.log(`[adaptv] wrote ${privacyManifest}`)
    }
  }

  //The route generator emits every import AND every `declare module` in
  //routeTree.gen.ts against a single package specifier. adaptv patches it to read
  //this env var (patches/@tanstack__router-generator.patch), so the generated
  //tree points at the adaptv barrel instead of @tanstack/* — the last place
  //`@tanstack` leaked into the consumer's tree. → DECISIONS.md §2.6a (L19)
  const routerPkg = options.routerSpecifier ?? DEFAULT_ROUTER_SPECIFIER
  process.env.ADAPTV_ROUTER_PKG = routerPkg
  //same for the Start register-declaration Start injects into the route tree
  //footer (patches/@tanstack__start-plugin-core.patch)
  process.env.ADAPTV_START_PKG = routerPkg

  //The route generator's scratch dir defaults to `<cwd>/.tanstack/tmp`, so a
  //consumer who never installed TanStack still gets a `.tanstack/` at their app
  //root on every run. NO PATCH NEEDED: upstream reads `TSR_TMP_DIR`, and the
  //resolved `router.tmpDir` (set in deriveStartOptions) takes precedence over it.
  //
  //Both levers, deliberately. `router.tmpDir` is the declared path for the
  //generator Start owns; the env var is the catch-all for every OTHER `getConfig()`
  //call in the process — router-plugin's autoimport, code-splitter and HMR plugins
  //each re-parse their own options object, and adaptv does not construct those.
  //Miss one and the default quietly reappears. → src/vite/adaptv-dir.ts
  process.env.TSR_TMP_DIR = resolveGeneratedTmpDir(appRoot)

  //Tell the virtual-route DSL where the generated root lives. It sits in
  //`.adaptv/`, but the generator resolves virtual route files against
  //`routesDirectory`, so the DSL needs a path relative to THAT — which only this
  //layer knows. Without it the consumer's routes tree would have to host a
  //framework artifact.
  //Where the route DSL finds adaptv's root route.
  //
  //`routesDirectory` is resolved against `src/`, not the app root — same base as
  //the router entry and the route tree (measured against Start 1.167.13) — so
  //this is a relative path from the app's routes folder into the installed
  //package. It is not pretty in the generated tree, but it is CORRECT under every
  //install layout (pnpm symlinks, hoisted node_modules, a workspace link),
  //because it is computed from the module's real resolved location rather than
  //guessed from a package name.
  process.env.ADAPTV_ROOT_ROUTE_FILE = path
    .relative(
      path.resolve(
        appRoot,
        "src",
        context.loaded.config.router.routesDirectory ?? "./routing",
      ),
      fileURLToPath(new URL("../routes/root-route.tsx", import.meta.url)),
    )
    .split(path.sep)
    .join("/")

  buildManifest(context.loaded.config, appRoot) //fail fast on a bad manifest
  stampGeneratedFiles(context)

  return [
    //FIRST, and `enforce: "pre"` — the isomorphism ban has to win the specifier
    //before tanstackStart() can resolve it. This is the one layer a consumer
    //cannot disable, misconfigure, or forget to install. → FACADE.md §2.2
    adaptvBanServerApisPlugin(),
    //Also `enforce: "pre"`, and for the same kind of reason: it has to reach the
    //app's stylesheet before @tailwindcss/vite compiles the Tailwind import away.
    //→ src/vite/css-layer-order.ts
    adaptvCssLayerOrderPlugin(),
    //The mirror image of the line above: `enforce: "post"`, because it rewrites what
    //@tailwindcss/vite PRODUCED. Without it every `ring-*` in the app silently renders
    //nothing on Android WebView 113–118. → src/vite/ring-shadow-fallback.ts
    adaptvRingShadowPlugin(),
    adaptvConfigLoaderPlugin(context),
    adaptvManifestPlugin(context),
    adaptvDefaultIconsPlugin(context),
    adaptvPwaRegisterPlugin(),
    //Also `enforce: "pre"`, and NOT as a precaution: Vite's own asset plugin
    //claims any unknown query on a known image extension, so at normal
    //enforcement `import hero from "./x.jpg?adaptv-image"` resolves to a bare URL
    //string and this plugin's `load` is never called — a build that succeeds with
    //every dimension silently gone. → src/vite/adaptv-image.ts, IMAGE-COMPONENT §4.2a
    adaptvImagePlugin({
      placeholder: context.loaded.config.images?.placeholder,
    }),
    adaptvRootRoutePlugin(context, options.routerSpecifier),
    adaptvRouteTreeAliasPlugin(appRoot),
    adaptvFsAllowPlugin(),
    //adaptv supplies the route factory binding, from ITS specifier. Paired with
    //`verboseFileRoutes: false` below, which makes the generator STRIP the
    //`@tanstack/react-router` import from route files rather than maintain it.
    //Together: zero `@tanstack/*` in the consumer's source.
    //→ src/vite/router-autoimport.ts
    adaptvRouteAutoImportPlugin(options.routerSpecifier),
    //Start's plugins, minus its own autoimport — upstream hardcodes the
    //`@tanstack/<target>-router` specifier and would re-add that import.
    stripTanStackAutoImport([
      tanstackStart(
        deriveStartOptions(
          context.loaded.config,
          routerEjected,
          clientEjected,
          appRoot,
          web,
        ),
      ) as PluginOption,
    ]),
    viteReact(),
    adaptvSwBuildPlugin(context),
    //Assert the opacity invariant on the generated tree once the build is done.
    //If the patches did not reach this install the build would otherwise SUCCEED
    //with the facade silently disabled. → src/vite/verify-patches.ts
    adaptvShellEmitPlugin(context),
    adaptvStaticHostPlugin(context),
    adaptvOpacityCheckPlugin(appRoot, routerPkg),
  ]
}

/** TanStack Start options — mapped from the loaded `adaptv.config.ts`; adaptv adds the stamped router entry. */
function deriveStartOptions(
  config: AdaptvAppConfig,
  routerEjected: boolean,
  clientEjected: boolean,
  appRoot: string,
  web: ResolvedWebConfig,
) {
  const router = config.router
  const gen = resolveGeneratedPaths(appRoot)
  //VERIFIED against Start 1.167.13 by building a real app: BOTH the router entry
  //and the generator's `generatedRouteTree` resolve relative to `src/`, not to the
  //app root. Passing a root-relative path here does not error — the generator
  //silently writes to `src/<path>` instead, so the route tree lands somewhere
  //nothing imports and the build fails much later with an unresolved import.
  const fromSrc = (abs: string) =>
    path.relative(path.join(appRoot, "src"), abs)
  //from the resolved web block — NOT `router.render`, whose legacy default was
  //"spa" and contradicted the documented "ssr". → DECISIONS.md conflict 3.3
  const isSpa = web.render === "spa"

  return {
    //SPA prerenders a static shell + hydrates on the client; SSR server-renders.
    ...(isSpa ? { spa: { enabled: true } } : {}),
    //Client entry, in precedence order:
    //  1. app ejected → their `src/client.tsx`.
    //  2. SPA target → adaptv's OWN client entry (a package module, like the router
    //     entry). Start's default is `hydrateStart`, which requires a `window.$_TSR`
    //     bootstrap that only a server/prerender injects — a no-server SPA has none,
    //     so `hydrateStart` throws `Invariant failed` and the app white-screens.
    //     adaptv's entry does a plain TanStack Router client render instead.
    //  3. SSR web → Start's built-in default (server provides `$_TSR`; leave it).
    ...(clientEjected
      ? { client: { entry: "./client" } }
      : isSpa
        ? {
            client: {
              entry: `./${fromSrc(
                fileURLToPath(
                  new URL("../routes/client-entry.tsx", import.meta.url),
                ),
              )}`,
            },
          }
        : {}),
    ...(router.serverEntry
      ? { server: { entry: router.serverEntry } }
      : {}),
    router: {
      //Always into `.adaptv/`, never wherever the config pointed. The route tree
      //is a build artifact, and letting an app place it next to its routes is
      //what made the generator visible in the first place. ARCHITECTURE §3.2
      generatedRouteTree: fromSrc(gen.routeTree),
      //Scratch space for the generator's write-then-rename, into `.adaptv/tmp/`
      //instead of a `.tanstack/` at the app root. Absolute (unlike the two paths
      //above): `tmpDir` is resolved against `process.cwd()`, not `src/`.
      tmpDir: resolveGeneratedTmpDir(appRoot),
      routesDirectory: router.routesDirectory ?? "./routing",
      //Formatting of files nobody opens (they live in `.adaptv/`) is adaptv's call,
      //not a config knob. Hardcoded.
      quoteStyle: "double" as const,
      //THE lever for TanStack opacity, and it is not a verbosity setting despite
      //the name. Read from the generator's transform source: `false` switches its
      //import policy from "require `createFileRoute` from @tanstack/<target>-router"
      //to "BAN it" — so the generator strips the import from route files instead of
      //writing it. adaptv's autoimport plugin then supplies the binding from the
      //adaptv barrel at build time. Not overridable: the whole facade rests on it.
      verboseFileRoutes: false,
      virtualRouteConfig: router.routerConfig ?? "./src/routing/config.ts",
      //adaptv's OWN entry module — a real file in the package, not one written
      //into the consumer's tree. It reaches the app's route tree through the
      //`#adaptv-route-tree` alias. Ejectable by writing `src/router.tsx`.
      ...(routerEjected
        ? {}
        : {
            entry: `./${fromSrc(
              fileURLToPath(
                new URL("../routes/router-entry.tsx", import.meta.url),
              ),
            )}`,
          }),
    },
  }
}

/**
 * Dev watcher: on a change to `adaptv.config.ts` (or a module it imports), re-load
 * the config, re-stamp the generated files, and full-reload. The initial load +
 * stamp happen in the `adaptv()` factory. Changing a BUILD option (`render` or the
 * `router` paths) still needs a dev-server restart — those configure Start, which
 * is instantiated once at startup.
 */
function adaptvConfigLoaderPlugin(context: AdaptvContext): PluginOption {
  return {
    name: "adaptv:config-watcher",
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

/**
 * Resolve `#adaptv-route-tree` to the app's generated route tree.
 *
 * adaptv's router entry is a package module, so it cannot use a relative import to
 * reach a file in the consumer's project. The app's `tsconfig.paths` carries the
 * same mapping (written by the stamper) so the route tree's concrete TYPE reaches
 * the `Register` augmentation — a bundler-only alias builds fine while silently
 * collapsing typed routing to `any`.
 *
 * ⚠︎ Resolved in a `resolveId` HOOK, never via `config().resolve.alias`.
 *
 * That distinction cost a full debugging session. TanStack Start resolves its own
 * entry points — including `virtual:tanstack-start-client-entry` — through
 * `resolve.alias`. A second plugin returning `resolve.alias` from `config()`
 * clobbered that map, so the client entry 404'd, the app never hydrated, and the
 * page rendered perfect SSR HTML with dead buttons and a spinner that never
 * resolved. **`vite build` passed the whole time**, because the build never
 * requests that module the same way.
 *
 * A `resolveId` hook only ever answers for its own specifier, so it cannot
 * collide with another plugin's resolution.
 */
/**
 * Let Vite's dev server read files from adaptv's own package.
 *
 * adaptv ships modules the app must load at runtime — the router entry, the root
 * route — and TanStack Start's default client/server entries resolve out of
 * adaptv's `node_modules` too, because adaptv is the package that depends on Start.
 * When adaptv is linked (a workspace, `file:`, or `pnpm link`), all of that lives
 * **outside the app root**, and Vite's `fs.allow` sandbox refuses to serve it.
 *
 * The symptom is brutal to diagnose: `virtual:tanstack-start-client-entry` 404s,
 * so the client bundle never loads, so the app renders perfect SSR HTML with dead
 * buttons and a spinner that never resolves — and **`vite build` passes**, because
 * the build reads from disk instead of going through the dev server's sandbox.
 */
/**
 * APPEND a root to Vite's resolved `server.fs.allow`, never REPLACE it. Returning
 * `server.fs.allow` from a plugin's `config()` suppresses Vite's computed default (the
 * app's own workspace root), which then makes the app's generated files unreadable — and
 * only in the cloudflare/workerd SSR environment, whose `fetchModule` honours the
 * allow-list strictly, so every request 500s with "Failed to load url". The client
 * transform hides it. Pushing in `configResolved` keeps the default AND adds adaptv's own
 * root. Idempotent so repeated resolves don't duplicate the entry. → offline PR.
 */
export function addFsAllowRoot(allow: string[], root: string): void {
  if (!allow.includes(root)) allow.push(root)
}

export function adaptvFsAllowPlugin(): PluginOption {
  //the package root — two levels up from src/vite/
  const packageRoot = fileURLToPath(new URL("../..", import.meta.url))
  return {
    name: "adaptv:fs-allow",
    configResolved(resolved) {
      addFsAllowRoot(resolved.server.fs.allow, packageRoot)
    },
  }
}

function adaptvRouteTreeAliasPlugin(appRoot: string): PluginOption {
  const routeTree = resolveGeneratedPaths(appRoot).routeTree
  return {
    name: "adaptv:route-tree-alias",
    enforce: "pre",
    resolveId(source) {
      if (source === "#adaptv-route-tree") return routeTree
      return null
    },
  }
}
