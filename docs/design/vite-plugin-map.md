# adaptv — a map of `src/vite/`

**33 non-test files. This page says which are core seams, which are one-off shims, and — the part
that matters most — where the ORDER is load-bearing.**

Two of the plugins below are composed here but no longer *live* here: the OTA slice moved
`ota-config-module.ts`, `ota-emit.ts` and `ota-zip.ts` to [`src/ota/build/`](../../src/ota/build/),
beside the policy and updater they serve. The array is unchanged; only the import path is.
→ [`../roadmap/src-reorg.md`](../roadmap/src-reorg.md) §2.2

Everything is composed by one function: `adaptvPlugin()` in
[`src/vite/adaptv-plugin.ts`](../../src/vite/adaptv-plugin.ts). That file returns a single flat array,
and Vite calls same-`order` hooks in plugin-array position. **Several adjacent pairs in that array
have a documented reason to sit where they do; read §2 before reordering anything.**

---

## 1. The composition, in array order

| # | Plugin | File | Why here |
|---|---|---|---|
| 1 | `adaptvBanServerApisPlugin` | `ban-server-apis.ts` | **`enforce: "pre"`, and FIRST.** The isomorphism ban must win the specifier before the framework plugin resolves it. The one layer a consumer cannot disable, misconfigure, or forget. |
| 2 | `adaptvCssLayerOrderPlugin` | `css-layer-order.ts` | Also `pre` — must reach the app's stylesheet **before** `@tailwindcss/vite` compiles the Tailwind import away. |
| 3 | `adaptvRingShadowPlugin` | `ring-shadow-fallback.ts` | The mirror image: `enforce: "post"`, because it rewrites what `@tailwindcss/vite` **produced**. |
| 4 | `adaptvConfigLoaderPlugin` | *(local to `adaptv-plugin.ts`)* | Serves the loaded `adaptv.config.ts` as a module. |
| 5 | `adaptvManifestPlugin` | `manifest.ts` | The web app manifest. |
| 6 | `adaptvDefaultIconsPlugin` | `default-icons.ts` | Falls back to the shipped icon set. |
| 7 | `adaptvPwaRegisterPlugin` | `virtuals.ts` | `virtual:adaptv/pwa-register`. The dev hatch arms **only** on the web target. |
| 8 | `adaptvOtaConfigPlugin` | `src/ota/build/ota-config-module.ts` | `virtual:adaptv/ota-config`. |
| 9 | `adaptvSecureStoragePlugin` | `secure-storage-module.ts` | `virtual:adaptv/secure-storage` — the Keychain/KeyStore backend. |
| 10 | `adaptvRouteTintsPlugin` | `route-tints-module.ts` | Reads `chromeTint` out of route files at build time. |
| 11 | `adaptvImagePlugin` | `adaptv-image.ts` | **`enforce: "pre"`, and not as a precaution.** See §2.1. |
| 12 | `adaptvRootRoutePlugin` | `root-route-module.ts` | The generated root route. |
| 13 | `adaptvRouteTreeAliasPlugin` | *(local)* | Aliases the generated tree. |
| 14 | `adaptvFsAllowPlugin` | *(local)* | Widens Vite's `fs.allow` to the generated dir. |
| 15 | `adaptvRouteAutoImportPlugin` | `router-autoimport.ts` | Race guard: supplies the route-factory binding for the beat before the generator writes it. |
| 16 | *(framework plugin)* | — wrapped by `stripTanStackAutoImport` | Defensive filter; the upstream autoimport plugin was folded into the generator, so it is a no-op unless a release re-introduces it. |
| 17 | `adaptvDeployServerPlugins` | `deploy-server.ts` | **Position is documented upstream behaviour**, see §2.2. Empty for `render: "spa"`. |
| 18 | `viteReact()` | — | The React transform, after the server environment is defined. |
| 19 | `adaptvShellEmitPlugin` | `shell-emit.ts` | **ORDER IS LOAD-BEARING**, see §2.3. |
| 20 | `adaptvSwBuildPlugin` | `sw-build.ts` | ″ |
| 21 | `adaptvSwDevPlugin` | `sw-dev.ts` | `apply: "serve"`, no-op unless `ADAPTV_DEV_SW` is set. |
| 22 | `adaptvStaticHostPlugin` | `static-host.ts` | **Web lineage only**, see §2.4. |
| 23 | `adaptvNativeBundlePlugin` | `native-bundle.ts` | The mirror image, native lineage only. |
| 24 | `adaptvOpacityCheckPlugin` | `route-tree-opacity.ts` | **Last.** Asserts the opacity invariant on the finished tree. → [`patches.md`](patches.md) |

## 2. The four places order is load-bearing

Each of these is a bug that shipped once.

### 2.1 The image plugin must be `pre`

Vite's own asset plugin **claims any unknown query on a known image extension**. At normal
enforcement, `import hero from "./x.jpg?adaptv-image"` resolves to a bare URL string and the plugin's
`load` is never called — a build that succeeds with every dimension silently gone.
→ [`image.md`](image.md) §4.2a

### 2.2 The server build sits between the framework plugin and `viteReact()`

That is the upstream-documented Nitro order. Moving it is not a stylistic choice.

### 2.3 Shell → SW → static-host, in that order, once the client output is complete

- **Shell before SW**: the shell must be on disk *before* the worker globs its precache manifest.
  Reversed, the worker binds its navigation fallback to a shell that did not exist when the manifest
  was built, and **every offline navigation dies** — SSR falls through to the browser error page, SPA
  throws `non-precached-url` at worker evaluation so no worker installs at all.
- **`buildApp`, not `closeBundle`, and that was MEASURED.** `closeBundle` fires *per environment*,
  before the deploy plugin has finished assembling the output directory: the precache glob ran
  against a half-populated dir and shipped a worker with **21 files silently missing** — every
  favicon, the offline illustrations, `robots.txt`.
- **…and not only `buildApp` at `post` either, which was MEASURED too.** That runs after the deploy
  plugin's whole `post` hook, and Nitro ends that hook by bundling the server with a public asset table
  baked from disk: `node .output/server/index.mjs` answered 404 for `/sw.js` and the shell. So the shell
  and the worker write through `emitIntoClientOutput` (`deploy-server.ts`) — at the start of Nitro's
  server environment, after `public/` is copied in, and in `buildApp` `post` only when no server is
  built. Static-host writes only under `spa` (it returns early otherwise), where no server exists, and stays in
  `buildApp` post. Nitro must stay ahead of the emitters in the plugin array, or `buildApp` post writes
  before `public/` is copied in.

### 2.4 Static-host is gated on `target`, never on `render`

A native bundle is `render: "spa"` **too**. Gating on `render` alone put `_redirects`, `404.html` and
`.nojekyll` inside every `.ipa`/`.apk` — files answering to an HTTP host the WebView does not have.

And note the mechanism: **not registering the plugin beats an early `return` in its hook.** There is
then no hook to reason about in the ordering above.

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
