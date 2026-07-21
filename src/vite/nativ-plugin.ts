import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import type { PluginOption } from "vite"
import type { NativAppConfig } from "#nativ/config/app-config.ts"
import type { ResolvedWebConfig } from "#nativ/config/web-config.ts"
import { resolveWebConfig } from "#nativ/config/web-config.ts"
import { stampPrivacyManifest } from "#nativ/native/stamp-privacy.ts"
import {
  APP_CONFIG_BASENAME,
  loadAppConfig,
} from "#nativ/vite/app-config-loader.ts"
import { nativBanServerApisPlugin } from "#nativ/vite/ban-server-apis.ts"
import { stampCapacitorConfig } from "#nativ/vite/capacitor-config.ts"
import {
  buildManifest,
  nativManifestPlugin,
} from "#nativ/vite/manifest.ts"
import type { NativContext } from "#nativ/vite/nativ-context.ts"
import { createNativContext } from "#nativ/vite/nativ-context.ts"
import { resolveGeneratedPaths } from "#nativ/vite/nativ-dir.ts"
import { nativRootRoutePlugin } from "#nativ/vite/root-route-module.ts"
import {
  nativRouteAutoImportPlugin,
  stripTanStackAutoImport,
} from "#nativ/vite/router-autoimport.ts"
import { nativShellEmitPlugin } from "#nativ/vite/shell-emit.ts"
import { stampGeneratedFiles } from "#nativ/vite/stamp.ts"
import { nativStaticHostPlugin } from "#nativ/vite/static-host.ts"
import { nativSwBuildPlugin } from "#nativ/vite/sw-build.ts"
import { assertRouteTreeIsOpaque } from "#nativ/vite/verify-patches.ts"
import { nativPwaRegisterPlugin } from "#nativ/vite/virtuals.ts"

/** Default specifier for every generated import. Overridable for aliased installs. */
const DEFAULT_ROUTER_SPECIFIER = "@arrzdev/nativ/router"

export type NativOptions = {
  /** App root holding `nativ.config.ts`. Default: `process.cwd()`. */
  appRoot?: string
  /**
   * Build target. `"capacitor"` produces the native shell bundle — forces a static
   * SPA (`render: "spa"`) and disables the service worker (`sw: false`), since a
   * Capacitor WebView loads on-device files (no server to SSR, and the bundle is the
   * offline shell). `"web"` (default) is the untouched SSR/PWA build. Falls back to
   * the `NATIV_TARGET` env var, so `NATIV_TARGET=capacitor vite build` works too.
   */
  target?: "web" | "capacitor"
  /**
   * The specifier route files import the route factory from. Default
   * `"@arrzdev/nativ/router"`.
   *
   * Exists because the package is not always reachable under its published name:
   * a monorepo may alias it (`@arrzdev/nativ`), and the injected import has to be
   * something the consumer's own resolver can actually follow. Getting it wrong
   * fails loudly at build time with an unresolved import, which is the right
   * failure mode.
   */
  routerSpecifier?: string
}

/**
 * The nativ framework plugin — one call in an app's `vite.config.ts`. Reads
 * `nativ.config.ts` (single source of truth) and wires the whole PWA:
 *
 * - stamps the generated root route + router (unless the app ejects by writing
 *   `layouts/_root.tsx` / `router.tsx`)
 * - drives TanStack Start — route tree + entries; the client entry is Start's
 *   default (StrictMode), ejectable by writing `src/client.tsx`
 * - generates the web manifest and the service-worker precache + build tag
 * - serves `virtual:nativ/pwa-register` for the shell
 *
 * Takes no arguments — the build config (`render`, `router` paths) lives in
 * `nativ.config.ts` too. It is an ASYNC plugin factory: it loads
 * the config first (so Start is configured from it and the generated files exist
 * before any hook), then returns the plugin array. Vite awaits plugin promises and
 * flattens nested arrays, so `plugins: [cloudflare(), nativ(), tailwindcss()]`
 * needs no `await` and no spread.
 */
export async function nativ(
  options: NativOptions = {},
): Promise<PluginOption[]> {
  const appRoot = options.appRoot ?? process.cwd()
  const context = createNativContext(appRoot)
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
    (process.env.NATIV_TARGET === "capacitor" ? "capacitor" : "web")
  //One resolution, used by every downstream plugin — so `render`, `host` and the
  //SW settings cannot drift between the router wiring, the manifest and the SW
  //build. The capacitor target is an OVERRIDE inside this call, not a default.
  const web = resolveWebConfig(context.loaded.config, target)
  context.web = web

  if (target === "capacitor") {
    context.loaded.config.router.render = "spa"
    context.loaded.config.sw = false
    //generate capacitor.config.json from the config's `appId` — cap reads this; the
    //consumer never hand-writes a Capacitor config. Stamped ONLY for the
    //native target so a plain web `dev`/`build` never materialises it in the app
    //root; the `nativ` CLI always builds this target before invoking cap.
    stampCapacitorConfig(context.loaded.config, appRoot)
    //Apple's required-reason API manifest, derived from the installed plugins.
    //Not one of the 22 official Capacitor plugins ships one, the obligation lands
    //on the app, and a missing manifest fails SILENTLY at App Store submission.
    //→ DECISIONS.md §5.0.1
    const privacyManifest = stampPrivacyManifest(appRoot)
    if (privacyManifest) {
      console.log(`[nativ] wrote ${privacyManifest}`)
    }
  }

  //The route generator emits every import AND every `declare module` in
  //routeTree.gen.ts against a single package specifier. nativ patches it to read
  //this env var (patches/@tanstack__router-generator.patch), so the generated
  //tree points at the nativ barrel instead of @tanstack/* — the last place
  //`@tanstack` leaked into the consumer's tree. → DECISIONS.md §2.6a (L19)
  const routerPkg = options.routerSpecifier ?? DEFAULT_ROUTER_SPECIFIER
  process.env.NATIV_ROUTER_PKG = routerPkg
  //same for the Start register-declaration Start injects into the route tree
  //footer (patches/@tanstack__start-plugin-core.patch)
  process.env.NATIV_START_PKG = routerPkg

  //Tell the virtual-route DSL where the generated root lives. It sits in
  //`.nativ/`, but the generator resolves virtual route files against
  //`routesDirectory`, so the DSL needs a path relative to THAT — which only this
  //layer knows. Without it the consumer's routes tree would have to host a
  //framework artifact.
  //Where the route DSL finds nativ's root route.
  //
  //`routesDirectory` is resolved against `src/`, not the app root — same base as
  //the router entry and the route tree (measured against Start 1.167.13) — so
  //this is a relative path from the app's routes folder into the installed
  //package. It is not pretty in the generated tree, but it is CORRECT under every
  //install layout (pnpm symlinks, hoisted node_modules, a workspace link),
  //because it is computed from the module's real resolved location rather than
  //guessed from a package name.
  process.env.NATIV_ROOT_ROUTE_FILE = path
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
    nativBanServerApisPlugin(),
    nativConfigLoaderPlugin(context),
    nativManifestPlugin(context),
    nativPwaRegisterPlugin(),
    nativRootRoutePlugin(context, options.routerSpecifier),
    nativRouteTreeAliasPlugin(appRoot),
    nativFsAllowPlugin(),
    //nativ supplies the route factory binding, from ITS specifier. Paired with
    //`verboseFileRoutes: false` below, which makes the generator STRIP the
    //`@tanstack/react-router` import from route files rather than maintain it.
    //Together: zero `@tanstack/*` in the consumer's source.
    //→ src/vite/router-autoimport.ts
    nativRouteAutoImportPlugin(options.routerSpecifier),
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
    nativSwBuildPlugin(context),
    //Assert the opacity invariant on the generated tree once the build is done.
    //If the patches did not reach this install the build would otherwise SUCCEED
    //with the facade silently disabled. → src/vite/verify-patches.ts
    nativShellEmitPlugin(context),
    nativStaticHostPlugin(context),
    nativOpacityCheckPlugin(appRoot),
  ]
}

/** TanStack Start options — mapped from the loaded `nativ.config.ts`; nativ adds the stamped router entry. */
function deriveStartOptions(
  config: NativAppConfig,
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
    //  2. SPA target → nativ's OWN client entry (a package module, like the router
    //     entry). Start's default is `hydrateStart`, which requires a `window.$_TSR`
    //     bootstrap that only a server/prerender injects — a no-server SPA has none,
    //     so `hydrateStart` throws `Invariant failed` and the app white-screens.
    //     nativ's entry does a plain TanStack Router client render instead.
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
      //Always into `.nativ/`, never wherever the config pointed. The route tree
      //is a build artifact, and letting an app place it next to its routes is
      //what made the generator visible in the first place. ARCHITECTURE §3.2
      generatedRouteTree: fromSrc(gen.routeTree),
      routesDirectory: router.routesDirectory ?? "./routing",
      //Formatting of files nobody opens (they live in `.nativ/`) is nativ's call,
      //not a config knob. Hardcoded.
      quoteStyle: "double" as const,
      //THE lever for TanStack opacity, and it is not a verbosity setting despite
      //the name. Read from the generator's transform source: `false` switches its
      //import policy from "require `createFileRoute` from @tanstack/<target>-router"
      //to "BAN it" — so the generator strips the import from route files instead of
      //writing it. nativ's autoimport plugin then supplies the binding from the
      //nativ barrel at build time. Not overridable: the whole facade rests on it.
      verboseFileRoutes: false,
      virtualRouteConfig: router.routerConfig ?? "./src/routing/config.ts",
      //nativ's OWN entry module — a real file in the package, not one written
      //into the consumer's tree. It reaches the app's route tree through the
      //`#nativ-route-tree` alias. Ejectable by writing `src/router.tsx`.
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
 * Dev watcher: on a change to `nativ.config.ts` (or a module it imports), re-load
 * the config, re-stamp the generated files, and full-reload. The initial load +
 * stamp happen in the `nativ()` factory. Changing a BUILD option (`render` or the
 * `router` paths) still needs a dev-server restart — those configure Start, which
 * is instantiated once at startup.
 */
function nativConfigLoaderPlugin(context: NativContext): PluginOption {
  return {
    name: "nativ:config-watcher",
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
 * Fails the build if the generated route tree still references `@tanstack/*` —
 * the signal that nativ's dependency patches did not reach this install.
 */
function nativOpacityCheckPlugin(appRoot: string): PluginOption {
  return {
    name: "nativ:opacity-check",
    apply: "build",
    closeBundle() {
      assertRouteTreeIsOpaque(resolveGeneratedPaths(appRoot).routeTree)
    },
  }
}

/**
 * Resolve `#nativ-route-tree` to the app's generated route tree.
 *
 * nativ's router entry is a package module, so it cannot use a relative import to
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
 * Let Vite's dev server read files from nativ's own package.
 *
 * nativ ships modules the app must load at runtime — the router entry, the root
 * route — and TanStack Start's default client/server entries resolve out of
 * nativ's `node_modules` too, because nativ is the package that depends on Start.
 * When nativ is linked (a workspace, `file:`, or `pnpm link`), all of that lives
 * **outside the app root**, and Vite's `fs.allow` sandbox refuses to serve it.
 *
 * The symptom is brutal to diagnose: `virtual:tanstack-start-client-entry` 404s,
 * so the client bundle never loads, so the app renders perfect SSR HTML with dead
 * buttons and a spinner that never resolves — and **`vite build` passes**, because
 * the build reads from disk instead of going through the dev server's sandbox.
 */
function nativFsAllowPlugin(): PluginOption {
  //the package root — two levels up from src/vite/
  const packageRoot = fileURLToPath(new URL("../..", import.meta.url))
  return {
    name: "nativ:fs-allow",
    config() {
      return { server: { fs: { allow: [packageRoot] } } }
    },
  }
}

function nativRouteTreeAliasPlugin(appRoot: string): PluginOption {
  const routeTree = resolveGeneratedPaths(appRoot).routeTree
  return {
    name: "nativ:route-tree-alias",
    enforce: "pre",
    resolveId(source) {
      if (source === "#nativ-route-tree") return routeTree
      return null
    },
  }
}
