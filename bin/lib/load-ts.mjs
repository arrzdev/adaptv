// Load one of adaptv's OWN TypeScript modules from the CLI.
//
// The CLI is plain `.mjs` that node runs directly, while the framework it drives is TS under
// `src/`. Several ideas are needed on both sides — the toolchain checks `doctor` reports, the
// Capacitor config, the app's icon set, the app's config and what makes it usable — and each one that gets reimplemented in `bin/`
// is a second implementation free to drift from the first (`docs/design/cli-contract.md` R26). This bundles the real
// module with esbuild and imports it from memory, so there is one copy of each idea and no
// build step between editing `src/` and running the CLI.
//
// A published package ships no `src/`, only `dist/`: there the same modules come prebuilt
// from `dist/cli/` (`tsdown.config.ts`, from the list in `cli-modules.mjs`). The checkout and
// a `link:`ed framework keep loading `src/`, so editing it still needs no build.
//
// Extracted from `bin/adaptv.mjs`, where it lived as a private helper: `bin/lib/*` modules
// need it too, and importing it back out of the entry point would be a cycle.
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { build as esbuild } from "esbuild"

// `import.meta.dirname`, not `fileURLToPath(import.meta.url)`: under vitest a module imported
// as a DEPENDENCY is served with a non-`file:` url and `fileURLToPath` throws on it, so the
// url form makes anything that transitively imports this file untestable. `dirname` is a plain
// path on both paths and has existed since node 20.11 (this package requires 22).
/** The framework package root — `bin/lib/` is two levels under it. */
export const ADAPTV_ROOT = path.resolve(import.meta.dirname, "../..")

/**
 * Where the framework's code comes from for this package: `src` in a checkout, `dist` in a
 * published package. Taken from the root rather than fixed, so a test can name one of each.
 */
export function frameworkLayout(root = ADAPTV_ROOT) {
  return existsSync(path.join(root, "src")) ? "src" : "dist"
}

/**
 * The directory the CLI's framework code is read from — what a cache keyed on "adaptv
 * changed" has to hash. → `otaCacheKey` in `bin/adaptv.mjs`
 */
export const FRAMEWORK_DIR = path.join(ADAPTV_ROOT, frameworkLayout())

/** `dist/cli/<rel>` with `.mjs` for `.ts` — where tsdown writes each module in `cli-modules.mjs`. */
export function builtModulePath(relFromSrc, root = ADAPTV_ROOT) {
  return path.join(
    root,
    "dist",
    "cli",
    relFromSrc.replace(/\.tsx?$/, ".mjs"),
  )
}

// Bundling is ~30ms and every caller wants the same handful of modules, sometimes once per
// platform in an `all` run. Keyed by specifier, resolved once per process.
const cache = new Map()

/**
 * Import `src/<relFromSrc>` — e.g. `loadAdaptvModule("vite/icon-set.ts")` — and return its
 * exports. Concurrent callers share one bundle: the PROMISE is cached, not just its result.
 */
export function loadAdaptvModule(relFromSrc) {
  const hit = cache.get(relFromSrc)
  if (hit) return hit
  const pending =
    frameworkLayout() === "src"
      ? bundle(relFromSrc)
      : import(pathToFileURL(builtModulePath(relFromSrc)).href)
  cache.set(relFromSrc, pending)
  return pending
}

// A bare package import (`esbuild`, `sharp`) is left where it is and pointed at by absolute
// URL. Inlining it would be wrong twice: a `data:` module cannot resolve a bare specifier at
// all, and esbuild's own API refuses to run from anywhere but its package (it locates its
// binary relative to itself). `node:` builtins need no help and are left alone.
const packagesStayOnDisk = {
  name: "adaptv-packages-stay-on-disk",
  setup(build) {
    build.onResolve({ filter: /^[^./#]/ }, (args) =>
      args.path.startsWith("node:")
        ? null
        : { path: import.meta.resolve(args.path), external: true },
    )
  },
}

async function bundle(relFromSrc) {
  const result = await esbuild({
    entryPoints: [path.join(ADAPTV_ROOT, "src", relFromSrc)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022",
    alias: { "#adaptv": path.join(ADAPTV_ROOT, "src") },
    plugins: [packagesStayOnDisk],
  })
  const source = result.outputFiles?.[0]?.text
  if (!source) throw new Error(`failed to bundle ${relFromSrc}`)
  return import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  )
}
