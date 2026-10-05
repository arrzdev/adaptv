# adaptv — the `dist` cutover

> 📐 **The flip is done.** `package.json` `exports` and `files` point at `dist/`, the CLI loads
> its framework modules from `dist/cli/` in a package without `src/`, and the ambient declarations
> ship with `route-globals.d.ts`. An app installed from the `pnpm pack` tarball runs `adaptv dev web`
> and `adaptv build web` (item 4, `examples/basic`), and the `create-adaptv` template carries the
> patches. **Left:** one finding about the playground shims (below).

---

## What already exists

| Piece | Where |
|---|---|
| The build | `tsdown.config.ts` — **two** builds, `platform: "browser"` for the React surface and `platform: "node"` for `/vite` + `/sw` + `/config`. A single build fails with `Could not resolve 'node:fs'`. |
| The verifier | `scripts/verify-dist.mjs`, run by `pnpm build:check` (`tsdown && node scripts/verify-dist.mjs`) |
| The decision, with its evidence | [`../decisions/dist-build.md`](../decisions/dist-build.md) — including the four traps this specific package shape hits |
| `.d.ts` emission | `dts: true`, with `sourcesContent` kept so consumers get real stack traces **without** shipping `src/` |

## What is done

**The flip.** Every `exports` subpath names `dist/` (`{ types, default }` for the JS entries), and
`files` ships `dist` instead of `src`. `scripts/verify-dist.mjs` now checks that map and `files`
as written, not a staged copy of them. `imports` keeps `#adaptv/*` → `./src/*` as a single target:
`vitest.config.ts` loads `src/` modules through Node, which needs it. Nothing in `dist/` uses it.

**In-repo consumers.** The playground and the website `link:` the checkout, so they now run the
built framework. `scripts/ensure-dist.mjs` builds when `src/` is newer than the last build, and
`pnpm dev:*` and `pnpm playground:setup` call it; `website.yml` builds before the site.

### The CLI no longer needs `src/`

`bin/lib/load-ts.mjs` loaded every framework module the CLI uses from `src/` with esbuild. A
fourth tsdown build now writes each module named in `bin/lib/cli-modules.mjs` to `dist/cli/`, and
the loader reads from there when the package has no `src/`. `pnpm build:check` loads all of them
from a package staged without `src/`. A checkout still loads `src/`, so editing it needs no build.

### The `/vite` entry no longer assumes `src/`

`src/vite/*` used to find files relative to its own `import.meta.url` (`../routes/*.tsx`,
`../sw/default-worker.ts`, `../..` as the package root, `../../patches`), which is right in
`src/vite/` and wrong from `dist/vite.mjs` or `dist/cli/**`. `src/vite/package-files.ts` now
finds the root by walking up to adaptv's `package.json` and hands the consumer's build the copy
that matches the layout it runs from. The modules that build compiles — the client and router
entries, the root route, the service worker and the boot screen — are tsdown entries, so
`dist/` has them. `pnpm build:check` fails on any `new URL("../…", import.meta.url)` left in
`dist/`.

Checked by hand once: an app from `create-adaptv`, linked against a staged package with no `src/`
and `exports` on `dist/`, passes `adaptv build web` (route tree, boot screen and `sw.js`
included).

### The playground shims: one is gone, two come from `link:`

The third shim, the `node_modules/@arrzdev/adaptv/src/**/virtual-adaptv-*.d.ts` include, is gone.
`src/interface/route-globals.d.ts` references all seven declarations by relative path, and tsdown
copies them into `dist/` with `src/`'s layout. `src/vite/stamp.ts` used to put
`node_modules/@arrzdev/adaptv/src/interface/route-globals.d.ts` in the app's `include`, but an
`exclude` of `node_modules` (the website's, and `create-adaptv`'s template) silently drops such an
entry. It now generates `.adaptv/adaptv-env.d.ts`, a `/// <reference types>` to
`@arrzdev/adaptv/route-globals` that resolves through `exports`. The two declarations that
imported `#adaptv/*` now import `@arrzdev/adaptv/router`, which resolves in a published package.
Checked in the playground and the website: the typecheck passes without the glob or the include
line, and fails on an `?adaptv-image` import when the generated reference or the
`/// <reference path>`s are removed.

**Shims 1 and 2 were not caused by `src/`.** With `exports` on `dist/` and both deleted, the
playground typecheck fails with the same two-copies errors (`vite.config.ts`: `PluginOption` from
the checkout's vite is not assignable to the app's; `SVGProps` from two `@types/react`). A `link:`
keeps the framework's real path, so `dist/*.d.mts` resolve `vite` and `react` from the checkout's
`node_modules`. A registry or tarball install resolves those peers to the app's copies, so a real
consumer does not need either line. They stay in the playground for as long as it uses `link:`.
Removing them would mean `injected` installs, which need a reinstall after every build.

### Two traps, carried

- **`sharp` must stay external.** If the cutover ever bundles `src/vite/`, `sharp` needs an
  `external` entry or the build breaks in a way that **only reproduces on the consumer's machine**.
  It is external today: `sharp` is a dependency, so tsdown leaves `import("sharp")` in place.
- **Shim 3 is the ambient-declaration question, and `"./image-asset"` is not its answer.** That
  entry used to read "`"./image-asset"` is still missing from `exports`"; it is missing on purpose
  (`../design/image.md` §13 row 12). All seven `src/**/virtual-adaptv-*.d.ts` files reach the consumer
  through that `include` glob and none is in `exports`, because a subpath export does not load an
  ambient declaration either — it is one consumer-side line whichever way it is delivered. What the
  cutover actually owes is a **path that survives it**: the glob names `…/adaptv/src/`, and after the
  flip the declarations live under `dist/`. Deleting shim 3 therefore means replacing the mechanism
  for all seven at once, not exporting one of them.

## Why it was deferred, and whether that still holds

The recorded reason was that shipping raw source means no build step, therefore no `prepare` script,
therefore no pnpm-11 `allowBuilds` entry — which is a git-dependency's main friction. That argument
was written when the answer was *"stay on raw source until there is a second consumer"*, and the repo
has since gone the other way: the build exists, `publishConfig` names GitHub Packages, and
[`../decisions/dist-build.md`](../decisions/dist-build.md) settles the question. **The deferral is now
about sequencing, not about the decision.**

## Definition of done

1. `package.json` `exports` point at `dist/`, `pnpm build:check` green.
2. The three playground shims are deleted and `pnpm typecheck` is still green — that is the real
   test, and it is the one that proves the cutover actually worked rather than merely built.
3. The seven `virtual-adaptv-*.d.ts` ambient declarations still reach a consumer once `src/` is no
   longer the shipped path — see the trap above.
4. An app from `create-adaptv`, installed from a `pnpm pack` tarball of the framework outside the
   repo, passes `adaptv build web`. ✅ Done 2026-10-05. The template carries the patches in the
   app's own `patches/`, because a `node_modules/@arrzdev/adaptv/patches/` block fails a fresh
   install with `ERR_PNPM_PATCH_NOT_FOUND`. An app created against the tarball, outside the repo,
   ran `pnpm install`, `adaptv build web` (exit 0) and `adaptv dev web` (200) with nothing copied
   by hand. `examples/basic` is that app, run by the README quick start.
   [`../design/create-adaptv.md §4`](../design/create-adaptv.md). `ssr.noExternal` stays in the
   template: dist imports `virtual:adaptv-*` modules, which Node cannot load in dev.
