import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import type { Plugin, PluginOption } from "vite"
import type { AdaptvAppConfig } from "#adaptv/config/app-config.ts"
import type { ResolvedWebConfig } from "#adaptv/config/web-config.ts"
import { resolveWebConfig } from "#adaptv/config/web-config.ts"
import { stampPrivacyManifest } from "#adaptv/native/stamp-privacy.ts"
import { adaptvOtaConfigPlugin } from "#adaptv/ota/build/ota-config-module.ts"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import {
  appRelativePath,
  createAdaptvContext,
} from "#adaptv/vite/adaptv-context.ts"
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
import { adaptvBuildStampPlugin } from "#adaptv/vite/build-stamp.ts"
import { adaptvClientTargetsPlugin } from "#adaptv/vite/client-targets.ts"
import { adaptvCssLayerOrderPlugin } from "#adaptv/vite/css-layer-order.ts"
import { adaptvDefaultIconsPlugin } from "#adaptv/vite/default-icons.ts"
import { adaptvDeployServerPlugins } from "#adaptv/vite/deploy-server.ts"
import { adaptvDevCssLoweringPlugin } from "#adaptv/vite/dev-css-lowering.ts"
import {
  adaptvManifestPlugin,
  buildManifest,
} from "#adaptv/vite/manifest.ts"
import { adaptvNativeBundlePlugin } from "#adaptv/vite/native-bundle.ts"
import { adaptvNativeShellPlugins } from "#adaptv/vite/native-shell-plugin.ts"
import { adaptvRootRoutePlugin } from "#adaptv/vite/root-route-module.ts"
import { adaptvRouteConfigWatchPlugin } from "#adaptv/vite/route-config-watch.ts"
import {
  adaptvRouteTintsPlugin,
  resolveRoutesDir,
} from "#adaptv/vite/route-tints-module.ts"
import { adaptvOpacityCheckPlugin } from "#adaptv/vite/route-tree-opacity.ts"
import {
  adaptvRouteAutoImportPlugin,
  stripTanStackAutoImport,
} from "#adaptv/vite/router-autoimport.ts"
import { adaptvSecureStoragePlugin } from "#adaptv/vite/secure-storage-module.ts"
import { adaptvShellEmitPlugin } from "#adaptv/vite/shell-emit.ts"
import { stampGeneratedFiles } from "#adaptv/vite/stamp.ts"
import { adaptvStaticHostPlugin } from "#adaptv/vite/static-host.ts"
import { adaptvSwBuildPlugin } from "#adaptv/vite/sw-build.ts"
import {
  adaptvSwDevPlugin,
  devServiceWorkerEnabled,
} from "#adaptv/vite/sw-dev.ts"
import { adaptvTailwindEmptyFallbackPlugin } from "#adaptv/vite/tailwind-empty-fallback.ts"
import { adaptvPwaRegisterPlugin } from "#adaptv/vite/virtuals.ts"

/**
 * Where the route config lives when `router.routerConfig` is unset. Relative to the
 * app root, which is what the generator joins it against.
 */
const DEFAULT_ROUTER_CONFIG = "./src/routing/config.ts"

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
 * - stamps the app's `.gitignore` and tsconfig wiring; the root route and router
 *   entry are package modules, ejected by passing a file to `rootRoute()` or by
 *   writing `src/router.tsx`
 * - drives TanStack Start — route tree + entries; the client entry is Start's
 *   default (StrictMode), ejectable by writing `src/client.tsx`
 * - generates the web manifest and the service-worker precache + build tag
 * - serves `virtual:adaptv/pwa-register` for the shell
 *
 * Called bare in an app's `vite.config.ts` — the build config (`render`, `router`
 * paths) lives in `adaptv.config.ts` too. {@link AdaptvOptions} exists for the
 * callers that cannot read it from there: the CLI's native lineage passes
 * `target`, and a linked/aliased install passes `appRoot` or `routerSpecifier`.
 *
 * It is an ASYNC plugin factory: it loads the config first (so Start is configured
 * from it and the generated files exist before any hook), then returns the plugin
 * array — which is also why every plugin's hooks can rely on `AdaptvContext` being
 * populated. Vite awaits plugin promises and
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

  //load the config first: Start and every plugin below are configured from it.
  context.loaded = await loadAppConfig(appRoot)

  //capacitor target: one source of truth still, but the native bundle is a static
  //SPA with no service worker. Mutate the loaded config before anything reads
  //it so the router wiring, manifest, and SW-build plugin all follow suit.
  const target =
    options.target ??
    (process.env.ADAPTV_TARGET === "capacitor" ? "capacitor" : "web")
  //The adaptv CLI's live-reload dev server (`adaptv dev ios|android`) sets this: the
  //bundle is served into a native WebView, which can't hydrate SSR — so force a
  //client SPA. (The service worker is handled at runtime — it never registers in
  //dev, see service-worker-shell.ts — so no build-time override is needed.) The
  //plain `web` target is kept otherwise, so an SSR/cloudflare dev pipeline still runs.
  if (target === "web" && process.env.ADAPTV_DEV_NATIVE === "1") {
    context.loaded.config.render = "spa"
  }
  //One resolution, used by every downstream plugin — so `render` and the SW
  //settings cannot drift between the router wiring, the manifest and the SW
  //build. The capacitor target is an OVERRIDE inside this call, not a default.
  const web = resolveWebConfig(context.loaded.config, target)
  context.web = web
  //The lineage itself, kept separately: `render` says how the app renders, this
  //says where the bundle is loaded from, and both capacitor and a static web
  //deploy answer the first one with "spa". → adaptv-context.ts
  context.target = target

  if (target === "capacitor") {
    //Nothing to force here: `resolveWebConfig` already returned `render: "spa"`
    //and `sw.enabled: false` for this target, and those are not overridable.
    //No capacitor.config.json is written: the `adaptv` CLI passes the generated config to
    //cap in-memory via the ADAPTV_CAPACITOR_CONFIG env var (its patched @capacitor/cli reads
    //it there), so the consumer's project never carries a Capacitor config file.
    //Apple's required-reason API manifest, derived from every plugin compiled in —
    //adaptv's own bundled set included, which is where the whole obligation lives for
    //an app that registered none of its own. Not one of the 22 official Capacitor
    //plugins ships a manifest, the obligation lands on the app, and a missing one
    //fails SILENTLY at App Store submission. → docs/decisions/register.md §5.0.1
    const privacyManifest = stampPrivacyManifest(appRoot, {
      plugins: context.loaded.config.plugins,
      privacy: context.loaded.config.privacy,
    })
    if (privacyManifest) {
      console.log(
        `[adaptv] wrote ${appRelativePath(context, privacyManifest)}`,
      )
    }
  }

  //The route generator emits every import AND every `declare module` in
  //routeTree.gen.ts against a single package specifier. adaptv patches it to read
  //this env var (patches/@tanstack__router-generator@*.patch), so the generated
  //tree points at the adaptv barrel instead of @tanstack/* — the last place
  //`@tanstack` leaked into the consumer's tree. → docs/decisions/register.md §2.6a (L19)
  const routerPkg = options.routerSpecifier ?? DEFAULT_ROUTER_SPECIFIER
  process.env.ADAPTV_ROUTER_PKG = routerPkg
  //same for the Start register-declaration Start injects into the route tree
  //footer (patches/@tanstack__start-plugin-core@*.patch)
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

  //One resolution of the routes directory, shared by the root-route path below
  //and the chrome-tint scan — they must look at the same folder or the scan
  //silently finds nothing. → `route-tints-module.ts`
  const routesDir = resolveRoutesDir(
    appRoot,
    context.loaded.config.router.routesDirectory,
  )

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
      routesDir,
      fileURLToPath(new URL("../routes/root-route.tsx", import.meta.url)),
    )
    .split(path.sep)
    .join("/")

  buildManifest(context.loaded.config, appRoot, "/") //fail fast on a bad manifest
  stampGeneratedFiles(context)

  return [
    //FIRST, and `enforce: "pre"` — the isomorphism ban has to win the specifier
    //before tanstackStart() can resolve it. This is the one layer a consumer
    //cannot disable, misconfigure, or forget to install. → docs/decisions/facade-and-opacity.md §2.2
    adaptvBanServerApisPlugin(),
    //Also `enforce: "pre"`, and for the same kind of reason: it has to reach the
    //app's stylesheet before @tailwindcss/vite compiles the Tailwind import away.
    //→ src/vite/css-layer-order.ts
    adaptvCssLayerOrderPlugin(),
    //Dev only, no `enforce`, and BEFORE the rewrite below: @tailwindcss/vite nests every
    //variant and writes breakpoints in range syntax, and lowers both only in a build, so in
    //dev every `app:`/`web:`/`hover:` utility was dead below Safari 16.5 and Chromium 112, and
    //every breakpoint below Safari 16.4. This applies the build's own pass, sheet by sheet.
    //It goes first so the rewrite gets lightningcss-printed CSS in dev too, as it always has
    //in a build, and the carriers the rewrite writes reach the browser as written.
    //→ src/vite/dev-css-lowering.ts
    adaptvDevCssLoweringPlugin(),
    //The mirror image of the line above: NO `enforce`, because it rewrites what
    //@tailwindcss/vite PRODUCED and `post` is already too late. Without it every ring
    //width and every utility that sets a `--tw-*` part (filters, numeric variants, touch
    //panning, 3D rotation, containment) silently computes nothing on Android WebView
    //113–118.
    //→ src/vite/tailwind-empty-fallback.ts
    adaptvTailwindEmptyFallbackPlugin(),
    adaptvConfigLoaderPlugin(context),
    //Both lineages, no gate: the capacitor bundle is the same client build, and
    //an iOS WebView is only ever as new as the OS it ships in. → src/vite/client-targets.ts
    adaptvClientTargetsPlugin(),
    adaptvManifestPlugin(context),
    adaptvDefaultIconsPlugin(context),
    //The dev hatch only ever arms on the web target: a native build has no dev
    //server of its own to serve from, and `sw.enabled` is already false there.
    adaptvPwaRegisterPlugin(
      web.sw.enabled,
      target === "web" && devServiceWorkerEnabled(),
      context.loaded.config.serviceWorkerUpdate ?? "auto",
    ),
    adaptvOtaConfigPlugin(context),
    adaptvSecureStoragePlugin(context),
    adaptvRouteTintsPlugin(routesDir),
    //Also `enforce: "pre"`, and NOT as a precaution: Vite's own asset plugin
    //claims any unknown query on a known image extension, so at normal
    //enforcement `import hero from "./x.jpg?adaptv-image"` resolves to a bare URL
    //string and this plugin's `load` is never called — a build that succeeds with
    //every dimension silently gone. → src/vite/adaptv-image.ts, `docs/design/image.md` §4.2a
    adaptvImagePlugin({
      placeholder: context.loaded.config.images?.placeholder,
    }),
    adaptvRootRoutePlugin(context, options.routerSpecifier),
    adaptvRouteTreeAliasPlugin(appRoot),
    //Dev only, and ahead of `tanstackStart()`: a running server otherwise never
    //regenerates after an edit to the route config, because the config is read
    //through a module cache that outlives the edit. → src/vite/route-config-watch.ts
    adaptvRouteConfigWatchPlugin({
      routerConfig: path.resolve(
        appRoot,
        context.loaded.config.router.routerConfig ?? DEFAULT_ROUTER_CONFIG,
      ),
      routesDir,
    }),
    adaptvFsAllowPlugin(),
    //Race guard: supplies the route-factory binding from adaptv's specifier for
    //the beat before the generator writes it. The generator itself keeps route
    //files opaque now — adaptv patches its `targetModule` to the barrel via
    //ADAPTV_ROUTER_PKG. → src/vite/router-autoimport.ts
    adaptvRouteAutoImportPlugin(options.routerSpecifier),
    //Defensive: the upstream `tanstack-router:autoimport` plugin was folded into
    //the generator and no longer exists, so this filter is a no-op unless a future
    //release re-introduces it.
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
    //The server build, and it sits HERE for a documented reason: Start's own
    //Nitro instructions are `tanstackStart(), nitro(), viteReact()` — after the
    //framework plugin that defines the server environment, before the React
    //transform. Empty for `render: "spa"`. → src/vite/deploy-server.ts
    ...(await adaptvDeployServerPlugins(web.render, {
      prerender: context.loaded.config.prerender === true,
    })),
    viteReact(),
    //ORDER IS LOAD-BEARING. Hooks of the same kind run in plugin-array order, so
    //the shell is emitted BEFORE the SW build globs the precache manifest, and
    //the static-host copy happens last. Reversed, the worker binds its navigation
    //fallback to a shell that was not on disk when the manifest was built, and
    //every offline navigation dies: SSR falls through to the browser error page,
    //and SPA throws `non-precached-url` at worker evaluation so no SW installs.
    //
    //WHEN they run was MEASURED at both ends. `closeBundle` fires per
    //environment, before the deploy plugin has copied `public/` in: the precache
    //glob ran against a half-populated dir and shipped a worker with 21 files
    //silently missing — every favicon, the offline illustrations, robots.txt.
    //`buildApp` at `post` runs after the deploy plugin's whole `post` hook, which
    //is too late for the shell and the worker: the node server had already baked
    //its public asset table, and answered 404 for both. So those two write in
    //`emitIntoClientOutput` — at the start of the server environment when there
    //is one, `buildApp` post when there is not. Nitro has to stay BEFORE them in
    //this array: its `buildApp` post hook is what copies `public/` in and builds
    //the server environment, so an emitter ahead of it would write first and
    //glob a half-populated dir. Static-host writes only under spa (it returns
    //early otherwise), where no server reads the output, so it stays in
    //`buildApp` post.
    adaptvShellEmitPlugin(context),
    adaptvSwBuildPlugin(context),
    //`apply: "serve"`, and a no-op unless ADAPTV_DEV_SW is set.
    adaptvSwDevPlugin(context),
    //Native `adaptv dev` only: answers whether the installed app is the build this session
    //serves, so a stale shell waits instead of reconnecting. → src/shell/native-shell.ts
    ...adaptvNativeShellPlugins(target),
    //Web lineage only. A Capacitor bundle is `render: "spa"` as well, so gating
    //this on `render` alone put `_redirects`, `404.html` and `.nojekyll` inside
    //every `.ipa`/`.apk` — files that answer to an HTTP host the WebView does
    //not have. Not registering the plugin beats an early `return` in its hook:
    //there is then no hook to reason about in the ordering above.
    ...(target === "web" ? [adaptvStaticHostPlugin(context)] : []),
    //The mirror image, for the native lineage: drop what only a browser tab
    //could ever read. `enforce: "post"`, so it runs after the router's own post-build
    //prerender, which writes the `_shell.html` this prunes. → src/vite/native-bundle.ts
    ...(target === "capacitor" ? [adaptvNativeBundlePlugin(context)] : []),
    //LAST of the emitters, on purpose: it writes down where this build wrote and what
    //it was built from, and both answers have to describe the FINAL directory — after
    //the shell, after the worker, after whichever of the two pruners above ran. Also
    //`enforce: "post"`, and after the native prune in this array, which is what keeps
    //it last now that the prune is an enforced plugin too. The CLI
    //reads it to name the output it produced and to know whether the bundle a native
    //sync is about to copy still belongs to the config on disk. → src/vite/build-stamp.ts
    adaptvBuildStampPlugin(context),
    //Assert the opacity invariant on the generated tree once the build is done.
    //If the patches did not reach this install the build would otherwise SUCCEED
    //with the facade silently disabled. → src/vite/verify-patches.ts
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
  const isSpa = web.render === "spa"

  return {
    //SPA prerenders a static shell + hydrates on the client; SSR server-renders.
    ...(isSpa ? { spa: { enabled: true } } : {}),
    //Client entry: the app's own `src/client.tsx` if it ejected, otherwise adaptv's
    //(a package module, like the router entry) — in BOTH render modes.
    //
    //Start's default entry renders `<StartClient />`, which requires a
    //`window.$_TSR` bootstrap that only a server or a prerender injects; without
    //it it throws `Invariant failed` before React mounts. That is not just the
    //no-server SPA case: an SSR app served OFFLINE gets the precached app shell,
    //which is generated from config and carries no bootstrap either. So the
    //decision belongs at runtime, to the document — see `client-entry.tsx`.
    ...(clientEjected
      ? { client: { entry: "./client" } }
      : {
          client: {
            entry: `./${fromSrc(
              fileURLToPath(
                new URL("../routes/client-entry.tsx", import.meta.url),
              ),
            )}`,
          },
        }),
    ...(router.serverEntry
      ? { server: { entry: router.serverEntry } }
      : {}),
    router: {
      //Always into `.adaptv/`, never wherever the config pointed. The route tree
      //is a build artifact, and letting an app place it next to its routes is
      //what made the generator visible in the first place. `docs/design/architecture.md` §3.2
      generatedRouteTree: fromSrc(gen.routeTree),
      //Scratch space for the generator's write-then-rename, into `.adaptv/tmp/`
      //instead of a `.tanstack/` at the app root. Absolute (unlike the two paths
      //above): `tmpDir` is resolved against `process.cwd()`, not `src/`.
      tmpDir: resolveGeneratedTmpDir(appRoot),
      routesDirectory: router.routesDirectory ?? "./routing",
      //Formatting of files nobody opens (they live in `.adaptv/`) is adaptv's call,
      //not a config knob. Hardcoded.
      quoteStyle: "double" as const,
      //TanStack opacity: the generator maintains the `createFileRoute` import in
      //route files itself (upstream removed `verboseFileRoutes` and the standalone
      //autoimport plugin). adaptv redirects the specifier it writes from
      //`@tanstack/<target>-router` to the adaptv barrel via a one-line patch on the
      //generator's `targetModule`, driven by ADAPTV_ROUTER_PKG (set above). So route
      //files end up importing `createFileRoute` from `@arrzdev/adaptv/router` — zero
      //`@tanstack/*` in the consumer's source. → src/vite/router-autoimport.ts,
      //patches/@tanstack__router-generator@*.patch
      virtualRouteConfig: router.routerConfig ?? DEFAULT_ROUTER_CONFIG,
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
 *
 * A save that does not load — a syntax error, or a value `appConfigErrors` refuses
 * — is reported in the terminal and on the page's error overlay, and the server
 * keeps the config that last loaded. It used to be a rejection nothing handled, and
 * a consumer's Vite runs from `node_modules`, where it installs no handler for one:
 * Node's default ended the dev server on a half-typed line. The next save that
 * loads full-reloads the page, which clears the overlay.
 *
 * A module the edited config starts importing joins the watch set, so its own
 * edits reload too.
 */
export function adaptvConfigLoaderPlugin(context: AdaptvContext): Plugin {
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
        try {
          const loaded = await loadAppConfig(context.appRoot)
          server.watcher.add(loaded.watchFiles)
          context.loaded = loaded
          stampGeneratedFiles(context)
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error)
          server.config.logger.error(
            `[adaptv] ${APP_CONFIG_BASENAME} did not reload, so the dev server keeps the last config that loaded:\n${message}`,
            { timestamp: true },
          )
          //No stack: it is esbuild's or the loader's own frames, and the message
          //already carries the file, the line and the key.
          server.ws.send({
            type: "error",
            err: {
              message,
              stack: "",
              id: configPath,
              plugin: "adaptv:config-watcher",
            },
          })
          return
        }
        server.ws.send({ type: "full-reload" })
      }

      server.watcher.on("change", (file) => void reload(file))
    },
  }
}

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
function adaptvFsAllowPlugin(): PluginOption {
  //the package root — two levels up from src/vite/
  const packageRoot = fileURLToPath(new URL("../..", import.meta.url))
  return {
    name: "adaptv:fs-allow",
    configResolved(resolved) {
      addFsAllowRoot(resolved.server.fs.allow, packageRoot)
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
 * ⚠︎ Resolved in a `resolveId` HOOK, never via `config().resolve.alias`, because a
 * `resolveId` hook only ever answers for its own specifier and so cannot collide
 * with another plugin's resolution.
 *
 * That distinction cost a full debugging session. TanStack Start resolves its own
 * entry points — including `virtual:tanstack-start-client-entry` — through
 * `resolve.alias`. A second plugin returning `resolve.alias` from `config()`
 * clobbered that map, so the client entry 404'd, the app never hydrated, and the
 * page rendered perfect SSR HTML with dead buttons and a spinner that never
 * resolved. **`vite build` passed the whole time**, because the build never
 * requests that module the same way.
 */
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
