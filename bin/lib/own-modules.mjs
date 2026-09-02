// What `doctor` checks when it says "adaptv's own install".
//
// This used to be a hand-written array of eleven package names in `bin/adaptv.mjs`, and by
// the time anyone read it again adaptv shipped fifteen: `@capacitor/clipboard`,
// `@capacitor/device`, `@capacitor/share` and `@capawesome/capacitor-live-update` — the OTA
// mechanism itself — had all been added to `package.json` and to nothing else. The row is
// the one thing `doctor` says about the modules compiled into the native binary, so those
// four could go missing and it would still report `complete`.
//
// A second list of what adaptv depends on will drift from `package.json` every time, so
// there isn't one. `package.json` `dependencies` IS the enumeration; the only question left
// is which of them reach the native binary, and that is answered by the test the native
// build tools themselves use — `carriesNativeCode` in `src/native/installed-plugins.ts`,
// imported rather than copied for the reason R26 gives.
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

/**
 * Where a package actually is on disk, or `null` when it is not installed at all.
 *
 * `require.resolve("<name>/package.json")` is the direct answer and the one that follows
 * pnpm's real layout — but a package whose `exports` map does not publish its own manifest
 * answers `ERR_PACKAGE_PATH_NOT_EXPORTED`: present, refusing to say where. Four of adaptv's
 * own dependencies do exactly that, so a probe that reads a throw as "not installed" paints
 * the row red on a perfectly healthy install.
 *
 * The walk is the second opinion, and it is node's own algorithm including the rule that
 * makes it work under pnpm: an ancestor that is itself a `node_modules` directory is
 * stepped over, so adaptv sitting at `…/.pnpm/adaptv@x/node_modules/adaptv` finds its
 * dependencies as its own siblings. Only when both come back empty is the package missing.
 */
export function locatePackage(name, from) {
  try {
    return path.dirname(
      createRequire(path.join(from, "package.json")).resolve(
        `${name}/package.json`,
      ),
    )
  } catch {}
  let dir = from
  for (;;) {
    if (path.basename(dir) !== "node_modules") {
      const candidate = path.join(dir, "node_modules", name)
      if (existsSync(path.join(candidate, "package.json")))
        return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * The native modules adaptv ships, and whatever it declares but cannot find.
 *
 * Two questions over one pass of adaptv's own manifest, because they have the same answer
 * for the dev — reinstall — and `doctor` says them as one row:
 *
 *   - **missing**: a declared dependency that is not on disk. Any of them, not just the
 *     native ones: a `sharp` that never unpacked breaks `adaptv icons` exactly as badly.
 *   - **modules**: the ones that put code in the native binary, which is what the row is
 *     about and what `--verbose` lists.
 *
 * A missing package is in BOTH — it cannot be tested for native code, and dropping it would
 * mean the one list `--verbose` prints omits the only names worth printing.
 *
 * `dependencies`, `locate` and `isNative` are passed in rather than reached for, so the
 * derivation is testable without a filesystem and the native test stays the framework's
 * single copy of itself.
 */
export function ownNativeModules({ dependencies, locate, isNative }) {
  const modules = []
  const missing = []
  for (const name of dependencies) {
    const dir = locate(name)
    if (dir === null) {
      missing.push(name)
      modules.push(name)
      continue
    }
    if (isNative(dir)) modules.push(name)
  }
  return { modules: modules.sort(), missing: missing.sort() }
}
