import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"
import { CLI_MODULES } from "./bin/lib/cli-modules.mjs"

/**
 * The dist build. → `docs/decisions/dist-build.md` ("The dist build — empirically settled")
 *
 * adaptv ships **built output**, not raw `.ts`. §6.2 proves why source-shipping
 * loses on this exact package shape: a dependency's tsconfig `paths` never apply
 * (`#adaptv/*` would be an unresolved import in the consumer), `skipLibCheck` does
 * not spare a consumer from typechecking `.ts` reached through `exports`, and JSX
 * in a `.ts` file is a hard failure. Dist-by-default is what essentially every
 * real library does; the registry metadata that looks like raw-TS shipping is
 * publish-time rewriting (the `@ark-ui/react` trap in §6.2).
 *
 * ## Two builds, not one — the load-bearing shape
 *
 * A single build fails with `Could not resolve 'node:fs'`: the React surface is
 * browser code, but `/vite`, `/sw` and `/config` are Node tools that legitimately
 * import `node:*`. Splitting by `platform` is the fix, and the split is verified
 * safe: every browser-surface import of a `config/*` module is `import type`
 * (erased at build), so no browser entry drags a `node:` builtin into its graph.
 *
 * ## What reads `dist/`
 *
 * Everything outside this repo's own `src/` tree: `package.json` `exports` and
 * `files` point here, so an app — the playground and the website included, through
 * `link:` — resolves `@arrzdev/adaptv/*` to this output and needs a build first
 * (`scripts/playground.mjs` runs one when `src/` is newer). The modules the `/vite`
 * entry hands the consumer's build are entries below, and
 * `src/vite/package-files.ts` picks the copy that matches the layout it runs from.
 * The fourth build puts every module the CLI loads into `dist/cli/`, which
 * `bin/lib/load-ts.mjs` reads when the package ships no `src/`.
 */

/** The React surface — everything a component tree imports at runtime. */
const browserEntry = {
  shell: "src/interface/shell.index.ts",
  router: "src/interface/router.index.ts",
  //Not an interface barrel — the actual module the generated route tree imports at
  //RUNTIME. It has an `exports` entry for exactly that reason (the tree names adaptv
  //rather than locating it on disk), so it needs a dist entry to match, or the
  //cutover ships an export map pointing at a file that was never built.
  //→ src/vite/route-tree-opacity.ts
  "root-route": "src/routes/root-route.tsx",
  components: "src/interface/components.index.ts",
  hooks: "src/interface/hooks.index.ts",
  capabilities: "src/interface/capabilities.index.ts",
  storage: "src/interface/storage.index.ts",
  ota: "src/interface/ota.index.ts",
  routes: "src/interface/routes.index.ts",
  utils: "src/interface/utils.index.ts",
  //Not public subpaths either: the modules adaptv's Vite plugin hands the CONSUMER's
  //build — Start's client and router entries, and the boot screen prerendered into the
  //shell. Entries of this build rather than copies, so they share chunks with the
  //surface above and the app gets one router, not two. → src/vite/package-files.ts
  "client-entry": "src/routes/client-entry.tsx",
  "router-entry": "src/routes/router-entry.tsx",
  "boot-error": "src/components/boot-error.tsx",
}

/**
 * The edge face — the Cloudflare Worker handler a consumer's `wrangler.toml` points `main`
 * at, and nothing else.
 *
 * It had an `exports` entry and no dist entry in any build here, so the one subpath that is
 * a whole runtime of its own was the one the publish spec promised and never produced.
 * `scripts/verify-dist.mjs` now derives its checks from `exports` and says so out loud.
 *
 * Its own build object rather than a line in either list above, because it belongs to
 * neither: a Worker is not Node (no `node:*`, so it cannot join `nodeEntry`), and it is not
 * a React client module either — the browser build stamps `"use client"` on every chunk it
 * emits, and that directive on the module a Worker BOOTS from is backwards, an RSC-aware
 * bundler's cue to replace the server handler with a client reference.
 */
const workerEntry = {
  "server-entry": "src/interface/server-entry.ts",
  //The service worker the consumer's build bundles with esbuild — a worker too, and
  //no client module. → src/vite/sw-build.ts, src/vite/package-files.ts
  "default-worker": "src/sw/default-worker.ts",
}

/** The Node tools — build-time (`/vite`, `/config`) and the SW toolkit. */
const nodeEntry = {
  vite: "src/interface/vite.index.ts",
  sw: "src/interface/sw.index.ts",
  config: "src/interface/config.index.ts",
}

/**
 * The framework modules the CLI loads at runtime, one entry each under `dist/cli/`, keyed by
 * their path under `src/` so `bin/lib/load-ts.mjs` finds each by the name it already uses.
 * A checkout loads them from `src/` with esbuild; a published package has no `src/`.
 */
const cliEntry = Object.fromEntries(
  CLI_MODULES.map((m) => [m.replace(/\.tsx?$/, ""), `src/${m}`]),
)

/** Shared across both builds so their outputs stay symmetrical. */
const base = {
  format: "esm",
  dts: true,
  // Keep sourcesContent embedded (tsdown's default) so consumers get real stack
  // traces WITHOUT shipping `src/`. → `docs/decisions/dist-build.md` "two smaller settled points".
  sourcemap: true,
  // Force `.mjs` + `.d.mts` on BOTH builds. `platform: "node"` alone makes tsdown
  // pick `.mjs` while the browser build defaults to `.js`; a single exports map
  // spanning two extensions is a footgun. One explicit extension everywhere.
  fixedExtension: true,
  // `virtual:adaptv/*` (and any `virtual:*`) are resolved by adaptv's OWN Vite
  // plugin inside the CONSUMER's build — e.g. `service-worker-shell.ts` imports
  // `virtual:adaptv/pwa-register`. They are never real files here, so they must
  // stay external; declaring it silences the UNRESOLVED_IMPORT guess.
  //
  // `#adaptv-route-tree` is external for a DIFFERENT and sharper reason: it must
  // survive into `dist/*.d.mts` as a live import. It is the app's generated route
  // tree, resolved per-app (Vite alias for the bundler, stamped tsconfig `paths`
  // for TypeScript), so the ONLY correct thing this build can emit is the
  // indirection itself. Inlined, it resolves here — against the framework's own
  // `AnyRoute` stub — and every consumer of the published package inherits
  // `getRouter(): RouterCore<AnyRoute, …>`, which is precisely the widening that
  // killed typed routing before. Measured: without this line `dist/router.d.mts`
  // baked `AnyRoute` in. → src/routes/route-tree-stub.d.ts, `docs/design/architecture.md` §3.2
  deps: { neverBundle: [/^virtual:/, /^#adaptv-route-tree$/] },
} satisfies UserConfig

export default defineConfig([
  {
    ...base,
    // Browser build runs first, so `clean` here (and NOWHERE else) wipes `dist/`
    // exactly once — §6.2: "Put clean: true on the first build object only."
    // The Node build must not clean, or it would delete this build's output.
    clean: true,
    platform: "browser",
    entry: browserEntry,
    // 🚨 `docs/decisions/dist-build.md` trap: Rolldown silently DROPS `"use client"` from non-entry modules
    // in bundle mode (present with unbundle, absent here). Re-assert it at the
    // Rolldown output layer so every emitted chunk — entries and shared chunks —
    // carries the directive. Browser build ONLY; the Node tools are not client
    // components. Grep `dist/` after building; the failure is silent.
    outputOptions: { banner: "'use client';" },
  },
  {
    ...base,
    clean: false,
    // Same resolution as the React surface — no `node:*` here either — but deliberately
    // NOT the same build, so it gets none of that build's `"use client"` banner.
    platform: "browser",
    entry: workerEntry,
  },
  {
    ...base,
    clean: false,
    platform: "node",
    entry: nodeEntry,
    // Copy assets on the LAST build so nothing later cleans over them.
    copy: [
      // Don't BUILD the CSS. → `docs/decisions/dist-build.md`: `@tsdown/css` is experimental, carries an
      // exact-version peer dep on tsdown, and would run adaptv's hand-authored
      // stylesheet through a second minifier before the consumer's own pipeline.
      // Copy the stylesheets flat so `index.css`'s relative `@import`s still
      // resolve. Glob the `.css` only — a bare dir copy nests (`dist/styles/styles`)
      // and drags in the co-located `utils.test.ts`.
      { from: "src/styles/*.css", to: "dist/styles" },
      // The ambient declarations — hand-authored `.d.ts`, not generated, so copied
      // verbatim. `route-globals.d.ts` is the one file an app's tsconfig names (stamped by
      // `src/vite/stamp.ts`); it pulls in the seven `virtual-adaptv-*.d.ts` with relative
      // `/// <reference path>`s, so `dist/` keeps their `src/` layout and the same
      // references hold in both trees. → `src/interface/route-globals.d.ts`
      {
        from: [
          "src/interface/route-globals.d.ts",
          "src/**/virtual-adaptv-*.d.ts",
        ],
        to: "dist",
        flatten: false,
      },
    ],
  },
  {
    ...base,
    clean: false,
    platform: "node",
    entry: cliEntry,
    outDir: "dist/cli",
    // Only the CLI imports these, from plain `.mjs`: no consumer types against them.
    dts: false,
  },
])
