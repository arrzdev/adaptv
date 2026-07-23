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

/**
 * Directories under a native project that don't describe the app BINARY — build output,
 * tool caches, and `public/` (the synced web bundle). `public/` matters most: during
 * live-reload the WebView loads from the dev server and never reads it, yet `cap sync`
 * rewrites it on every run — hashing it would break the cache on every JS edit, which is
 * exactly what this fingerprint exists to avoid.
 */
const NATIVE_SKIP_DIRS = new Set([
  "public",
  "build",
  ".gradle",
  "Pods",
  "DerivedData",
  "captures",
  "xcuserdata",
  ".idea",
  "node_modules",
  ".git",
])
const NATIVE_SKIP_FILES = new Set([".DS_Store", "local.properties"])

/**
 * A fingerprint of everything baked into the INSTALLED native app — deliberately NOT the
 * app's own JS/TS/CSS.
 *
 * This is the whole point of a separate fingerprint from `fingerprint()`: in live-reload
 * the installed binary is just a shell pointing at the dev server, so app code changes
 * cannot invalidate it (the web fingerprint hashes the source tree and would miss on
 * every keystroke, making the cache useless). What DOES invalidate it: the Capacitor
 * config — including `server.url`, so a `--port` change is caught — the declared
 * dependencies (adding/removing a native plugin), and the native project's own sources
 * (Info.plist, AndroidManifest, gradle, pbxproj, generated icons/splash).
 *
 * Hashes CONTENT, not size+mtime like `fingerprint()` does. That difference is load-
 * bearing: `generateAssets` re-stamps icons, colours and the launch storyboard into the
 * native project on every single run, writing byte-identical files with fresh mtimes. An
 * mtime-based hash therefore changed every run and the cache never hit once (measured).
 * Content hashing is also just the honest question — what the project CONTAINS, not when
 * it was last touched — and at ~90 files / 0.3 MB per platform it costs nothing.
 *
 * Compute it AFTER a sync/build, never before: `cap sync` rewrites files in the native
 * project, so a pre-sync fingerprint would never match the post-sync state.
 */
export function nativeFingerprint(appRoot, platform) {
  const h = createHash("sha1")
  const add = (label, file) => {
    try {
      h.update(`${label}:${readFileSync(file, "utf8")}\n`)
    } catch {
      h.update(`${label}:absent\n`)
    }
  }
  // The config carries appId, plugin settings, and the dev server URL/port.
  add("capacitor", path.join(appRoot, "capacitor.config.json"))
  // Declared deps = the native plugin set. Content, not mtime: an install can rewrite
  // package.json without changing what it declares.
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(appRoot, "package.json"), "utf8"),
    )
    h.update(
      `deps:${JSON.stringify({
        d: pkg.dependencies ?? {},
        dd: pkg.devDependencies ?? {},
      })}\n`,
    )
  } catch {
    h.update("deps:absent\n")
  }

  const nativeRoot = path.join(appRoot, NATIV_DIR, platform)
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!NATIVE_SKIP_DIRS.has(e.name)) walk(full)
      } else if (e.isFile() && !NATIVE_SKIP_FILES.has(e.name)) {
        try {
          h.update(`${path.relative(nativeRoot, full)}:`)
          h.update(readFileSync(full))
          h.update("\n")
        } catch {}
      }
    }
  }
  walk(nativeRoot)
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
