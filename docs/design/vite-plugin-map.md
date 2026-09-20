# adaptv — a map of `src/vite/`

**34 non-test files. This page says which are core seams, which are one-off shims, and — the part
that matters most — where the ORDER is load-bearing.**

Two of the plugins below are composed here but no longer *live* here: the OTA slice moved
`ota-config-module.ts`, `ota-emit.ts` and `ota-zip.ts` to [`src/ota/build/`](../../src/ota/build/),
beside the policy and updater they serve. The array is unchanged; only the import path is.
→ [`../roadmap/src-reorg.md`](../roadmap/src-reorg.md) §2.2

Everything is composed by one function: `adaptvPlugin()` in
[`src/vite/adaptv-plugin.ts`](../../src/vite/adaptv-plugin.ts). That file returns a single flat array,
and Vite calls same-`order` hooks in plugin-array position among plugins of the same `enforce` (every
plain plugin's hook runs before any `enforce: "post"` one's). **Several adjacent pairs in that array
have a documented reason to sit where they do; read §2 before reordering anything.**

---

## 1. The composition, in array order

| # | Plugin | File | Why here |
|---|---|---|---|
| 1 | `adaptvBanServerApisPlugin` | `ban-server-apis.ts` | **`enforce: "pre"`, and FIRST.** The isomorphism ban must win the specifier before the framework plugin resolves it. The one layer a consumer cannot disable, misconfigure, or forget. |
| 2 | `adaptvCssLayerOrderPlugin` | `css-layer-order.ts` | Also `pre` — must reach the app's stylesheet **before** `@tailwindcss/vite` compiles the Tailwind import away. |
| 3 | `adaptvDevCssLoweringPlugin` | `dev-css-lowering.ts` | **Dev only, no `enforce`, and before #4.** Applies the lowering a build applies — Tailwind's pass to a sheet Tailwind compiled, nesting alone to any other — which `@tailwindcss/vite` skips in dev. See §2.5. |
| 4 | `adaptvTailwindEmptyFallbackPlugin` | `tailwind-empty-fallback.ts` | The mirror image: **no `enforce`**, because it rewrites what `@tailwindcss/vite` **produced** — `pre` sees no utilities yet and `post` is already past Vite's CSS stage. |
| 5 | `adaptvConfigLoaderPlugin` | `adaptv-plugin.ts` (exported for its test) | Dev watcher: re-loads `adaptv.config.ts` on a save, and keeps the last config that loaded when a save does not. → [`lifecycle.md`](lifecycle.md) §2.1 |
| 6 | `adaptvManifestPlugin` | `manifest.ts` | The web app manifest. |
| 7 | `adaptvDefaultIconsPlugin` | `default-icons.ts` | Falls back to the shipped icon set. |
| 8 | `adaptvPwaRegisterPlugin` | `virtuals.ts` | `virtual:adaptv/pwa-register`. The dev hatch arms **only** on the web target. |
| 9 | `adaptvOtaConfigPlugin` | `src/ota/build/ota-config-module.ts` | `virtual:adaptv/ota-config`. |
| 10 | `adaptvSecureStoragePlugin` | `secure-storage-module.ts` | `virtual:adaptv/secure-storage` — the Keychain/KeyStore backend. |
| 11 | `adaptvRouteTintsPlugin` | `route-tints-module.ts` | Reads `chromeTint` out of route files at build time. |
| 12 | `adaptvImagePlugin` | `adaptv-image.ts` | **`enforce: "pre"`, and not as a precaution.** See §2.1. |
| 13 | `adaptvRootRoutePlugin` | `root-route-module.ts` | The generated root route. |
| 14 | `adaptvRouteTreeAliasPlugin` | *(local)* | Aliases the generated tree. |
| 15 | `adaptvFsAllowPlugin` | *(local)* | Widens Vite's `fs.allow` to the generated dir. |
| 16 | `adaptvRouteAutoImportPlugin` | `router-autoimport.ts` | Race guard: supplies the route-factory binding for the beat before the generator writes it. |
| 17 | *(framework plugin)* | — wrapped by `stripTanStackAutoImport` | Defensive filter; the upstream autoimport plugin was folded into the generator, so it is a no-op unless a release re-introduces it. |
| 18 | `adaptvDeployServerPlugins` | `deploy-server.ts` | **Position is documented upstream behaviour**, see §2.2. Empty for `render: "spa"`. |
| 19 | `viteReact()` | — | The React transform, after the server environment is defined. |
| 20 | `adaptvShellEmitPlugin` | `shell-emit.ts` | **ORDER IS LOAD-BEARING**, see §2.3. |
| 21 | `adaptvSwBuildPlugin` | `sw-build.ts` | ″ |
| 22 | `adaptvSwDevPlugin` | `sw-dev.ts` | `apply: "serve"`, no-op unless `ADAPTV_DEV_SW` is set. |
| 23 | `adaptvStaticHostPlugin` | `static-host.ts` | **Web lineage only**, see §2.4. |
| 24 | `adaptvNativeBundlePlugin` | `native-bundle.ts` | The mirror image, native lineage only. **`enforce: "post"`**, see §2.5. |
| 25 | `adaptvBuildStampPlugin` | `build-stamp.ts` | **Last of the emitters**, `enforce: "post"` and after the native prune: it records where the build wrote and hashes the final shell. |
| 26 | `adaptvOpacityCheckPlugin` | `route-tree-opacity.ts` | **Last.** Asserts the opacity invariant on the finished tree. → [`patches.md`](patches.md) |

## 2. The five places order is load-bearing

Each of these is a bug that shipped once.

### 2.1 The image plugin must be `pre`

Vite's own asset plugin **claims any unknown query on a known image extension**. At normal
enforcement, `import hero from "./x.jpg?adaptv-image"` resolves to a bare URL string and the plugin's
`load` is never called — a build that succeeds with every dimension silently gone.
→ [`image.md`](image.md) §4.2a

### 2.2 The server build sits between the framework plugin and `viteReact()`

That is the upstream-documented Nitro order. Moving it is not a stylistic choice.

### 2.3 Shell → SW → static-host, in that order, in `buildApp` at `order: "post"`

- **Shell before SW**: the shell must be on disk *before* the worker globs its precache manifest.
  Reversed, the worker binds its navigation fallback to a shell that did not exist when the manifest
  was built, and **every offline navigation dies** — SSR falls through to the browser error page, SPA
  throws `non-precached-url` at worker evaluation so no worker installs at all.
- **`buildApp`, not `closeBundle`, and that was MEASURED.** `closeBundle` fires *per environment*,
  before the deploy plugin has finished assembling the output directory: the precache glob ran
  against a half-populated dir and shipped a worker with **21 files silently missing** — every
  favicon, the offline illustrations, `robots.txt`. `buildApp` at `post` runs after the environments
  *and* after the deploy plugin's own `post` hook.

### 2.4 Static-host is gated on `target`, never on `render`

A native bundle is `render: "spa"` **too**. Gating on `render` alone put `_redirects`, `404.html` and
`.nojekyll` inside every `.ipa`/`.apk` — files answering to an HTTP host the WebView does not have.

And note the mechanism: **not registering the plugin beats an early `return` in its hook.** There is
then no hook to reason about in the ordering above.

### 2.5 The native prune is `enforce: "post"`, not just late in the array

The router writes its prerendered `_shell.html` from a `buildApp` hook that is `enforce: "post"` with
`order: "post"`, and Vite runs every plain plugin's `order: "post"` hook before any enforced plugin's,
whatever the array says. As a plain plugin the prune ran first and the file landed a second later: the
log printed the prune above `Prerendering pages`, every `.adaptv/web` shipped the 66 KB file, and
because it carries the render's time, two builds of one checkout got two OTA build tags. Among
enforced plugins array order holds again, so the prune sits after the framework plugin and the build
stamp, also enforced, sits after the prune. A real Vite build in `native-bundle.test.ts` holds it.
→ [`../decisions/register.md`](../decisions/register.md) B31

### 2.6 The dev lowering pass runs before the empty-fallback rewrite

Both are normal plugins (no `enforce`) for the same two reasons: `pre` runs before
`@tailwindcss/vite:generate:serve` and sees no utilities, `post` runs after Vite's CSS stage has turned
the sheet into JavaScript. Between the two of them, the lowering pass goes **first**, because that is the
order a build already has: Tailwind's `optimize` runs inside its own `pre` transform, so the rewrite has
only ever been handed lightningcss-printed CSS in production. In dev it now gets the same — flat rules,
`min-width` breakpoints, and `var(--x, )` with the printer's space, which its patterns accept
(`dev-css-lowering.test.ts` pipes the real dev sheet through it). Reversed, lightningcss would re-print
the carriers the rewrite writes before they reach the one WebView they exist for, a byte shape no build
ships.
→ [`../decisions/register.md`](../decisions/register.md), "In dev, every Tailwind variant and breakpoint was dead"

## 3. Support modules (not plugins)

These are imported by the plugins above, or by `bin/`. They register no Vite hooks.

| File | Role | Used by |
|---|---|---|
| `adaptv-context.ts` | The shared state every plugin reads: `loaded`, `target`, `web`. | 11 plugins |
| `adaptv-dir.ts` | `.adaptv/` — the hidden generated directory (**D1**). → [`architecture.md`](architecture.md) §3.2 | 5 modules + `bin/` |
| `stamp.ts` | Stamps the generated directory with project wiring. | `adaptv-plugin.ts` |
| `app-config-loader.ts` | Loads `adaptv.config.ts` in Node **as data**, bundled with esbuild. | `adaptv-plugin.ts` |
| `capacitor-config.ts` | The native config, derived from `adaptv.config.ts`. **Never written to disk** — passed in memory. → [`patches.md`](patches.md) §1 | `bin/`, `native-bundle.ts` |
| `app-shell.ts` | The generated app shell. → [`rendering.md`](rendering.md) §3.1.2, [`lifecycle.md`](lifecycle.md) §1.2 | `shell-emit.ts` |
| `boot-fallback-prerender.ts` | Renders the app's error component to static HTML **at build time**. | `shell-emit.ts` |
| `route-tints.ts` | Extracts `chromeTint` from route files. | `route-tints-module.ts`, `shell-emit.ts`, `src/shell/` |
| `icon-set.ts` | The resolved icon set. | 5 plugins + 5 `bin/` modules — **the widest-reach module here** |
| `build-tag.ts` | Service-worker cache namespace, derived once per production build. | `sw-build.ts` |
| `thunk-specifiers.ts` | Reads the literal import specifier out of a component thunk. | `shell-emit.ts`, `root-route-module.ts` |
| `serialize.ts` | Serializes a config value into a JS source expression. | `root-route-module.ts` |
| `verify-patches.ts` | Fails loudly when the dependency patches are absent. → [`patches.md`](patches.md) | `route-tree-opacity.ts`, `adaptv-plugin.ts`, `bin/` |

## 4. Reading order for a newcomer

1. `adaptv-plugin.ts` — the whole composition, with the reasoning inline as comments.
2. `adaptv-context.ts` — what every plugin is handed.
3. `adaptv-dir.ts` — where everything generated goes.
4. Then whichever plugin you came for; each is self-contained.

**The comments in `adaptv-plugin.ts` are the canonical version of §2.** If they and this page ever
disagree, the file wins and this page is stale.
