// Build fingerprint cache — lets `run`/`build` skip the web build + sync when nothing
// that affects the bundle has changed, so a re-launch goes (almost) straight to the
// native build. → user ask: "if the web build didn't change, bypass steps, launch faster".
//
// The fingerprint is a hash of every app file's path + size + mtime (a superset of the
// SPA inputs). Over-inclusive on purpose: an unrelated edit just triggers a rebuild
// (safe), whereas a missed edit would launch stale code (never acceptable). `--force`
// bypasses it. State lives in `.nativ/build-cache.json` (git-ignored with `.nativ/`).
import { createHash } from "node:crypto"
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { NATIV_DIR } from "./native.mjs"

// Directories that never affect the built bundle (deps, outputs, VCS, caches, the
// native projects themselves). Skipped wholesale while walking.
const SKIP_DIRS = new Set([
  "node_modules",
  NATIV_DIR,
  "dist",
  "ios",
  "android",
  ".git",
  ".turbo",
  ".vite",
  ".tsbuild",
  "coverage",
  "DerivedData",
  "Pods",
  "build",
  ".idea",
  ".gradle",
])
// Generated files (not inputs) — excluding them keeps the fingerprint stable across
// builds that regenerate them.
const SKIP_FILES = new Set(["capacitor.config.json", ".DS_Store"])

const cacheFile = (appRoot) =>
  path.join(appRoot, NATIV_DIR, "build-cache.json")

/** A hash of the app's source tree (path + size + mtime of every non-skipped file). */
export function fingerprint(appRoot) {
  const h = createHash("sha1")
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name))
      } else if (e.isFile() && !SKIP_FILES.has(e.name)) {
        try {
          const s = statSync(path.join(dir, e.name))
          h.update(
            `${path.relative(appRoot, path.join(dir, e.name))}:${s.size}:${Math.round(s.mtimeMs)}\n`,
          )
        } catch {}
      }
    }
  }
  walk(appRoot)
  return h.digest("hex")
}

export function readCache(appRoot) {
  try {
    return JSON.parse(readFileSync(cacheFile(appRoot), "utf8"))
  } catch {
    return {}
  }
}

export function writeCache(appRoot, cache) {
  mkdirSync(path.join(appRoot, NATIV_DIR), { recursive: true })
  writeFileSync(cacheFile(appRoot), `${JSON.stringify(cache, null, 2)}\n`)
}
