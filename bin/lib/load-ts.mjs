// Load one of adaptv's OWN TypeScript modules from the CLI.
//
// The CLI is plain `.mjs` that node runs directly, while the framework it drives is TS under
// `src/`. Several ideas are needed on both sides — the toolchain checks `doctor` reports, the
// Capacitor config, and now the app's icon set — and each one that gets reimplemented in `bin/`
// is a second implementation free to drift from the first (`docs/design/cli-contract.md` R26). This bundles the real
// module with esbuild and imports it from memory, so there is one copy of each idea and no
// build step between editing `src/` and running the CLI.
//
// Extracted from `bin/adaptv.mjs`, where it lived as a private helper: `bin/lib/*` modules
// need it too, and importing it back out of the entry point would be a cycle.
import path from "node:path"
import { build as esbuild } from "esbuild"

// `import.meta.dirname`, not `fileURLToPath(import.meta.url)`: under vitest a module imported
// as a DEPENDENCY is served with a non-`file:` url and `fileURLToPath` throws on it, so the
// url form makes anything that transitively imports this file untestable. `dirname` is a plain
// path on both paths and has existed since node 20.11 (this package requires 22).
/** The framework package root — `bin/lib/` is two levels under it. */
export const ADAPTV_ROOT = path.resolve(import.meta.dirname, "../..")

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
  const pending = bundle(relFromSrc)
  cache.set(relFromSrc, pending)
  return pending
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
  })
  const source = result.outputFiles?.[0]?.text
  if (!source) throw new Error(`failed to bundle ${relFromSrc}`)
  return import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  )
}
