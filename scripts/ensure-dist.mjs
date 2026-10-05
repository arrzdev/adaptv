/**
 * Build `dist/` when the checkout has changed since the last build.
 *
 * `package.json` `exports` point at `dist/`, so the playground and the website — both
 * `link:`ed to this checkout — run the BUILT framework, exactly as a published install
 * would. Without this, an edit under `src/` would reach the CLI (which still loads `src/`
 * in a checkout, `bin/lib/load-ts.mjs`) and not the app, and the two would disagree.
 *
 * Fresh means: no input is newer than the stamp a successful build leaves. The stamp lives
 * under `node_modules/.cache`, not in `dist/`, because `dist/` ships.
 */
import { spawnSync } from "node:child_process"
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

/** What the build reads: the source tree, its config, and the CLI module list. */
const INPUTS = [
  "src",
  "tsdown.config.ts",
  "package.json",
  "bin/lib/cli-modules.mjs",
]

function newestInput(root) {
  let newest = 0
  for (const input of INPUTS) {
    const abs = path.join(root, input)
    const stat = statSync(abs)
    if (!stat.isDirectory()) {
      newest = Math.max(newest, stat.mtimeMs)
      continue
    }
    for (const f of readdirSync(abs, { recursive: true }))
      newest = Math.max(newest, statSync(path.join(abs, f)).mtimeMs)
  }
  return newest
}

function stampTime(stamp) {
  try {
    return statSync(stamp).mtimeMs
  } catch {
    return -1
  }
}

/**
 * @returns `true` when `dist/` is fresh (already, or after building); `false` when the
 *   build failed — tsdown has printed why.
 */
export function ensureDist(root, { onBuild } = {}) {
  const stamp = path.join(root, "node_modules", ".cache", "adaptv-dist")
  if (stampTime(stamp) >= newestInput(root)) return true
  onBuild?.()
  const r = spawnSync("pnpm", ["run", "--silent", "build"], {
    cwd: root,
    stdio: "inherit",
  })
  if (r.status !== 0) return false
  mkdirSync(path.dirname(stamp), { recursive: true })
  writeFileSync(stamp, "")
  return true
}
